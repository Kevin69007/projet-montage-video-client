#!/usr/bin/env node

/**
 * Worker — Kimi API (Moonshot) video editing agent.
 * Production-grade: retries, coaching, context re-injection, output verification.
 *
 * Usage: node worker.mjs <jobId>
 * Env: KIMI_API_KEY (required), KIMI_MODEL (default kimi-k2.6), GEMINI_API_KEY (optional)
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  buildSystemPrompt,
  buildUserPrompt,
  rewritePromptForReadFallback,
  IMAGE_DESCRIPTION_PROMPT,
  buildContextReminder,
  buildOutputsReminder,
  coachToolError,
  buildTaskSummary,
} from "./prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: node worker.mjs <jobId>");
  process.exit(1);
}

const jobDir = path.join(__dirname, "jobs", jobId);
const statusPath = path.join(jobDir, "status.json");
const PIPELINE_DIR = path.join(__dirname, "pipeline");
const SCRIPTS_DIR = path.join(PIPELINE_DIR, "scripts");
const FONTS_DIR = path.join(PIPELINE_DIR, "fonts");

const KIMI_API_URL = "https://api.moonshot.ai/v1/chat/completions";
const KIMI_MODEL = process.env.KIMI_MODEL || "kimi-k2.6";
const VISION_MODEL = "moonshot-v1-128k-vision-preview";
const MAX_ITERATIONS = 100;
const MAX_TOKENS = 8000;
const API_RETRIES = 3;
const CONTEXT_REMINDER_EVERY = 7;
const OUTPUTS_JSON_RETRIES = 2;
const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour overall timeout
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB max for vision API

// --- Status helpers ---

function writeError(message) {
  console.error(`[WORKER ${jobId}] ERROR: ${message}`);
  try {
    const status = fs.existsSync(statusPath)
      ? JSON.parse(fs.readFileSync(statusPath, "utf-8"))
      : { log: [] };
    status.status = "error";
    status.step = "Erreur";
    status.message = message;
    status.log = [...(status.log || []), `[${new Date().toISOString()}] WORKER ERROR: ${message}`];
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch (e) {
    console.error("Failed to write error status:", e);
  }
}

function updateStatus(updates) {
  const status = fs.existsSync(statusPath)
    ? JSON.parse(fs.readFileSync(statusPath, "utf-8"))
    : { status: "processing", step: "", progress: 0, message: "", outputs: [], log: [] };
  Object.assign(status, updates);
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

function addLog(message) {
  console.log(`[WORKER ${jobId}] ${message}`);
  const status = fs.existsSync(statusPath)
    ? JSON.parse(fs.readFileSync(statusPath, "utf-8"))
    : { log: [] };
  status.log = [...(status.log || []), `[${new Date().toISOString()}] ${message}`];
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

// --- Find ffmpeg with libass ---

function findFfmpegFull() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "ffmpeg";
}


// --- Progress detection ---

function detectProgress(text) {
  if (text.includes("generate_thumbnail.py") || text.includes("nano-banana")) return { step: "Composition", progress: 70, message: "Composition de la miniature..." };
  if (text.includes("frames:v 1")) return { step: "Extraction frames", progress: 30, message: "Extraction des frames..." };
  if (text.includes("transcribe.py")) return { step: "Transcription", progress: 20, message: "Transcription Whisper en cours..." };
  if (text.includes("ffprobe")) return { step: "Analyse", progress: 10, message: "Analyse du fichier video..." };
  if (text.includes("ffmpeg") && (text.includes("-ss") || text.includes("concat"))) {
    if (text.includes("burn_subtitles") || text.includes(".ass")) return null;
    if (text.includes("text_frame") || text.includes("generate_text_frame")) return null;
    return { step: "Decoupe", progress: 40, message: "Decoupe et assemblage des segments..." };
  }
  if (text.includes("burn_subtitles")) return { step: "Sous-titres", progress: 65, message: "Application des sous-titres..." };
  if (text.includes("generate_text_frame")) return { step: "Text frame", progress: 80, message: "Generation de l'ecran de fin..." };
  if (text.includes("outputs.json")) return { step: "Sauvegarde", progress: 95, message: "Sauvegarde des fichiers..." };
  return null;
}

// --- Tool schemas (explicit WHEN/HOW guidance) ---

const TOOLS = [
  {
    type: "function",
    function: {
      name: "Bash",
      description: "Execute a shell command. USE for: ffmpeg, ffprobe, python scripts (transcribe.py, burn_subtitles.py, generate_text_frame.py), nano-banana, ls, cp, mkdir, cat. DO NOT USE for: generating outputs.json (use Write instead). Returns stdout+stderr (truncated if > 10K chars).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command. Can be multi-line. Use proper quoting for paths with spaces." },
          timeout: { type: "number", description: "Timeout in seconds (default 1800 = 30min). Use 600 for quick ops, 3600 for heavy transcode." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file's content. USE for: transcription JSON (mandatory before planning cuts), styles.json, checking intermediate outputs. For images, returns an AI-generated description. Max 5MB file size. Text truncated to 18K chars if larger.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file" }
        },
        required: ["file_path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "Write",
      description: "Write content to a file (creates or overwrites). USE EXCLUSIVELY for: outputs.json manifest at the END of the job (MANDATORY — without it the work is lost). DO NOT USE for: creating videos/images/audio (use Bash with ffmpeg/scripts instead).",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path. For manifest, use the exact path given in the user prompt." },
          content: { type: "string", description: "File content. For outputs.json, must be valid JSON array of {file, label, description} objects." }
        },
        required: ["file_path", "content"]
      }
    }
  }
];

// --- Tool executors ---

function execBash(command, timeoutSec = 1800, env = {}) {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeoutSec * 1000,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const trimmed = output.trim();
    if (trimmed.length > 10000) {
      return trimmed.slice(0, 5000) + "\n\n[...output truncated...]\n\n" + trimmed.slice(-3000);
    }
    return trimmed || "(no output — command succeeded with empty stdout)";
  } catch (err) {
    const stderr = (err.stderr || "").toString().trim();
    const stdout = (err.stdout || "").toString().trim();
    const combined = [stdout, stderr].filter(Boolean).join("\n");
    if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
      return `ERROR: Command timed out after ${timeoutSec}s\n${combined.slice(-2000)}`;
    }
    return `ERROR (exit ${err.status}):\n${combined.slice(-3000) || err.message}`;
  }
}

async function execRead(filePath) {
  if (!fs.existsSync(filePath)) return `ERROR: File not found: ${filePath}`;
  const stats = fs.statSync(filePath);
  if (stats.size > 5 * 1024 * 1024) return `ERROR: File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Use Bash with head/tail to sample.`;

  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(filePath);
  if (isImage) {
    return await describeImage(filePath);
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (content.length > 20000) {
      return content.slice(0, 15000) + "\n\n[...truncated...]\n\n" + content.slice(-3000);
    }
    return content;
  } catch (err) {
    return `ERROR reading file: ${err.message}`;
  }
}

function execWrite(filePath, content) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return `File written: ${filePath} (${content.length} chars)`;
  } catch (err) {
    return `ERROR writing file: ${err.message}`;
  }
}

// --- Image description via Kimi vision (detailed) ---

const imageDescriptionCache = new Map();
const visionUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

async function describeImage(filePath) {
  // Cache by absolute path + mtime (so edits invalidate)
  try {
    const stats = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stats.mtimeMs}:${stats.size}`;
    if (imageDescriptionCache.has(cacheKey)) {
      return imageDescriptionCache.get(cacheKey);
    }

    const imgBuffer = fs.readFileSync(filePath);
    if (imgBuffer.length > MAX_IMAGE_BYTES) {
      return `[Image ${path.basename(filePath)} trop grande (${(imgBuffer.length / 1024 / 1024).toFixed(1)}MB). Utilise Bash + ImageMagick pour la redimensionner: \`magick "${filePath}" -resize 1024x1024 "${filePath}.small.jpg"\` puis Read sur le fichier redimensionne.]`;
    }
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext;
    const base64 = imgBuffer.toString("base64");
    const dataUrl = `data:image/${mime};base64,${base64}`;

    const res = await fetch(KIMI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: IMAGE_DESCRIPTION_PROMPT }
            ]
          }
        ],
        max_tokens: 1200,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return `[Image ${path.basename(filePath)} — vision error ${res.status}: ${errText.slice(0, 200)}]`;
    }
    const data = await res.json();

    // Track vision API usage (separate model, cheaper but still counts)
    if (data.usage) {
      visionUsage.input_tokens += data.usage.prompt_tokens || 0;
      visionUsage.output_tokens += data.usage.completion_tokens || 0;
      visionUsage.total_tokens += data.usage.total_tokens || 0;
    }

    const description = data.choices?.[0]?.message?.content || "(no description)";
    const result = `[Analyse detaillee de ${path.basename(filePath)}]\n${description}`;

    // Cache
    imageDescriptionCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return `[Image ${path.basename(filePath)} — ${err.message}]`;
  }
}

// --- Kimi API call with retry ---

async function callKimi(messages) {
  const res = await fetch(KIMI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages,
      tools: TOOLS,
      temperature: 1,
      max_tokens: MAX_TOKENS,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Kimi API error ${res.status}: ${errText.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function callKimiWithRetry(messages) {
  let lastErr;
  for (let attempt = 0; attempt < API_RETRIES; attempt++) {
    try {
      return await callKimi(messages);
    } catch (err) {
      lastErr = err;
      const isHttpTransient = [429, 500, 502, 503, 504].includes(err.status);
      // Network errors (no .status): ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.
      const isNetworkError = !err.status && (
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.code === "ENOTFOUND" ||
        err.code === "ECONNREFUSED" ||
        err.message?.includes("fetch failed") ||
        err.message?.includes("network")
      );
      const isTransient = isHttpTransient || isNetworkError;

      if (isTransient && attempt < API_RETRIES - 1) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        const label = err.status ? `HTTP ${err.status}` : (err.code || "network error");
        addLog(`API ${label} — retry ${attempt + 1}/${API_RETRIES} dans ${backoff / 1000}s`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// --- Identify reference file for miniature mode ---

function findReferenceFile(params) {
  const inputDir = path.join(jobDir, "input");
  if (params.mode !== "miniature") return null;

  if (params.referenceFileName) {
    const sanitized = params.referenceFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const candidate = path.join(inputDir, sanitized);
    if (fs.existsSync(candidate)) return candidate;
    // Also try matching any file that contains the sanitized name
    for (const f of params.fileNames) {
      if (f.includes(sanitized)) return path.join(inputDir, f);
    }
  }
  // Fallback: first image file
  for (const f of params.fileNames) {
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(f)) return path.join(inputDir, f);
  }
  return null;
}

// --- Build first user message (may include inline reference image for miniature) ---

function buildUserMessage(params, userPromptText, referenceFile) {
  if (params.mode === "miniature" && referenceFile && fs.existsSync(referenceFile)) {
    try {
      const imgBuffer = fs.readFileSync(referenceFile);
      if (imgBuffer.length > MAX_IMAGE_BYTES) {
        addLog(`Image reference trop grande (${(imgBuffer.length / 1024 / 1024).toFixed(1)}MB) — fallback Read.`);
        return { role: "user", content: rewritePromptForReadFallback(userPromptText) };
      }
      const ext = path.extname(referenceFile).slice(1).toLowerCase();
      const mime = ext === "jpg" ? "jpeg" : ext;
      const base64 = imgBuffer.toString("base64");
      return {
        role: "user",
        content: [
          { type: "text", text: userPromptText },
          { type: "image_url", image_url: { url: `data:image/${mime};base64,${base64}` } },
        ],
      };
    } catch (err) {
      addLog(`Avertissement: impossible d'inclure l'image reference inline — ${err.message}`);
      return { role: "user", content: rewritePromptForReadFallback(userPromptText) };
    }
  }
  return { role: "user", content: userPromptText };
}

// --- Main ---

async function main() {
  console.log(`[WORKER ${jobId}] Starting (model=${KIMI_MODEL})...`);

  if (!process.env.KIMI_API_KEY) {
    writeError("KIMI_API_KEY not set. Ajoute-la dans le fichier .env");
    process.exit(1);
  }

  const paramsPath = path.join(jobDir, "params.json");
  if (!fs.existsSync(paramsPath)) {
    writeError(`params.json not found at ${paramsPath}`);
    process.exit(1);
  }

  let params;
  try {
    params = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
  } catch (e) {
    writeError(`params.json invalide: ${e.message}`);
    process.exit(1);
  }

  // Defensive defaults
  params.fileNames = Array.isArray(params.fileNames) ? params.fileNames : [];
  params.prompt = params.prompt || "(no prompt)";
  if (params.fileNames.length === 0) {
    writeError("Aucun fichier dans params.fileNames");
    process.exit(1);
  }

  console.log(`[WORKER ${jobId}] Params: mode=${params.mode || "video"}, prompt="${params.prompt.slice(0, 50)}..."`);

  const inputDir = path.join(jobDir, "input");
  const workDir = path.join(jobDir, "work");
  const outputDir = path.join(jobDir, "output");
  const outputsJsonPath = path.join(jobDir, "outputs.json");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const videoPaths = params.fileNames.map(f => path.join(inputDir, f));
  const ffmpegPath = findFfmpegFull();
  console.log(`[WORKER ${jobId}] FFmpeg: ${ffmpegPath}`);

  const referenceFile = findReferenceFile(params);

  const systemPrompt = buildSystemPrompt({
    ffmpegPath,
    scriptsDir: SCRIPTS_DIR,
    fontsDir: FONTS_DIR,
    pipelineDir: PIPELINE_DIR,
  });
  const userPromptText = buildUserPrompt(params, {
    videoPaths,
    workDir,
    outputDir,
    outputsJsonPath,
    pipelineDir: PIPELINE_DIR,
    inputDir,
    referenceFile,
  });

  // Task summary for context re-injection
  const taskSummary = buildTaskSummary(params, referenceFile);

  updateStatus({ status: "processing", step: "Initialisation", progress: 5, message: `Demarrage (${KIMI_MODEL})...` });
  if (params.mode === "miniature") {
    const videoCount = params.fileNames.filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f)).length;
    const imageCount = params.fileNames.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).length;
    addLog(`Mode miniature — ${videoCount} video(s), ${imageCount} image(s) reference`);
  } else {
    addLog(`Demarrage avec ${params.fileNames.length} video(s) — modele ${KIMI_MODEL}`);
  }

  const messages = [
    { role: "system", content: systemPrompt },
    buildUserMessage(params, userPromptText, referenceFile),
  ];

  // Build PATH: add common bin dirs (Docker = /usr/local/bin, Mac = /opt/homebrew/bin)
  const extraPaths = [
    "/root/.bun/bin",                             // Docker root bun
    path.join(process.env.HOME || "", ".bun", "bin"), // User bun
    path.join(process.env.HOME || "", ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(p => p && fs.existsSync(p));
  const toolEnv = {
    PATH: `${extraPaths.join(":")}:${process.env.PATH || ""}`,
    FFMPEG_PATH: ffmpegPath,
    FONTS_DIR: FONTS_DIR,
  };

  let lastProgress = 5;
  let iteration = 0;
  let outputsJsonReminderCount = 0;
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const jobStartTime = Date.now();

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Overall job timeout
    if (Date.now() - jobStartTime > JOB_TIMEOUT_MS) {
      addLog(`Timeout global atteint (${JOB_TIMEOUT_MS / 60000} min)`);
      break;
    }

    console.log(`[WORKER ${jobId}] Iteration ${iteration}/${MAX_ITERATIONS}`);

    // Context re-injection every N iterations
    if (iteration > 1 && iteration % CONTEXT_REMINDER_EVERY === 0) {
      messages.push({
        role: "user",
        content: buildContextReminder({
          iteration,
          maxIterations: MAX_ITERATIONS,
          taskSummary,
        }),
      });
    }

    let response;
    try {
      response = await callKimiWithRetry(messages);
    } catch (err) {
      addLog(`Erreur Kimi API (apres retries): ${err.message}`);
      writeError(`Kimi API: ${err.message}`);
      process.exit(1);
    }

    // Track tokens
    if (response.usage) {
      usage.input_tokens += response.usage.prompt_tokens || 0;
      usage.output_tokens += response.usage.completion_tokens || 0;
      usage.total_tokens += response.usage.total_tokens || 0;
    }

    const choice = response.choices?.[0];
    if (!choice || !choice.message) {
      addLog(`Reponse Kimi invalide (pas de choices/message): ${JSON.stringify(response).slice(0, 200)}`);
      break;
    }

    const message = choice.message;
    messages.push(message); // preserves reasoning_content + tool_calls + content

    if (message.content) {
      const text = message.content.trim();
      if (text) addLog(`Kimi: ${text.slice(0, 300)}`);
    }

    const toolCalls = message.tool_calls || [];

    // Done path: no tool calls
    if (toolCalls.length === 0) {
      // Verify outputs.json before declaring done
      let valid = false;
      if (fs.existsSync(outputsJsonPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(outputsJsonPath, "utf-8"));
          // Must be non-empty array where each entry has at least {file, label}
          if (Array.isArray(content) && content.length > 0 && content.every(e => e && typeof e.file === "string" && e.file.length > 0)) {
            // Verify files actually exist on disk
            const missing = content.filter(e => !fs.existsSync(path.join(outputDir, e.file)));
            if (missing.length === 0) valid = true;
            else addLog(`outputs.json liste des fichiers manquants: ${missing.map(m => m.file).join(", ")}`);
          }
        } catch (_) {}
      }

      if (!valid && outputsJsonReminderCount < OUTPUTS_JSON_RETRIES) {
        outputsJsonReminderCount++;
        addLog(`outputs.json manquant ou invalide — rappel ${outputsJsonReminderCount}/${OUTPUTS_JSON_RETRIES}`);
        // Scan output dir to suggest files
        let existingFiles = [];
        if (fs.existsSync(outputDir)) {
          existingFiles = fs.readdirSync(outputDir).filter(f => /\.(mp4|mov|jpg|jpeg|png|webm)$/i.test(f));
        }
        messages.push({
          role: "user",
          content: buildOutputsReminder({ outputDir, outputsJsonPath, existingFiles }),
        });
        continue;
      }

      addLog(`Pipeline termine (${iteration} tours)`);
      break;
    }

    // Execute tool calls
    for (const tc of toolCalls) {
      const fnName = tc.function?.name;
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch (_) {}

      let result = "";
      if (fnName === "Bash") {
        const cmd = (args.command || "").trim();
        if (!cmd) {
          result = "ERROR: Bash called with empty command. Fournis un champ 'command' non-vide.";
        } else {
          const shortCmd = cmd.length > 150 ? cmd.slice(0, 150) + "..." : cmd;
          addLog(`Bash: ${shortCmd}`);
          const progress = detectProgress(cmd);
          if (progress) {
            // Step label updates immediately; progress bar stays monotonic
            const newProgress = Math.max(lastProgress, progress.progress);
            lastProgress = newProgress;
            updateStatus({ step: progress.step, progress: newProgress, message: progress.message });
          }
          result = execBash(cmd, args.timeout || 1800, toolEnv);
        }
      } else if (fnName === "Read") {
        const fp = args.file_path || "";
        if (!fp) {
          result = "ERROR: Read called without file_path.";
        } else {
          addLog(`Read: ${fp}`);
          result = await execRead(fp);
        }
      } else if (fnName === "Write") {
        const fp = args.file_path || "";
        if (!fp) {
          result = "ERROR: Write called without file_path.";
        } else if (typeof args.content !== "string") {
          result = "ERROR: Write called without string 'content' argument.";
        } else {
          const contentLen = args.content.length;
          addLog(`Write: ${fp} (${contentLen} chars)`);
          result = execWrite(fp, args.content);
          // Detect outputs.json write for progress
          if (fp === outputsJsonPath) {
            const newProgress = Math.max(lastProgress, 95);
            lastProgress = newProgress;
            updateStatus({ step: "Sauvegarde", progress: newProgress, message: "outputs.json ecrit..." });
          }
        }
      } else {
        result = `ERROR: Unknown tool: ${fnName}`;
      }

      // Coach on errors
      const finalResult = coachToolError(fnName, result);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: String(finalResult),
      });
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    addLog(`Limite d'iterations atteinte (${MAX_ITERATIONS})`);
  }

  // Collect outputs
  let outputs = [];
  if (fs.existsSync(outputsJsonPath)) {
    try {
      outputs = JSON.parse(fs.readFileSync(outputsJsonPath, "utf-8"));
      if (!Array.isArray(outputs)) outputs = [outputs];
      // Normalize entries: ensure file/label/description are always strings
      outputs = outputs
        .filter(e => e && typeof e.file === "string" && e.file.length > 0)
        .map(e => ({
          file: e.file,
          label: (typeof e.label === "string" && e.label.trim()) || e.file.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "),
          description: typeof e.description === "string" ? e.description : "",
        }));
      addLog(`Manifeste trouve: ${outputs.length} fichier(s)`);
    } catch (e) {
      addLog(`Erreur lecture outputs.json: ${e.message}`);
    }
  }

  // Fallback: scan output dir
  if (outputs.length === 0 && fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir).filter(f =>
      /\.(mp4|mov|avi|mkv|webm|jpg|jpeg|png)$/i.test(f)
    );
    if (files.length > 0) {
      outputs = files.map(f => ({
        file: f,
        label: f.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "),
        description: "",
      }));
      fs.writeFileSync(outputsJsonPath, JSON.stringify(outputs, null, 2));
      addLog(`Fallback: ${files.length} fichier(s) trouves dans output/`);
    }
  }

  // Cost estimation
  const PRICING = {
    "kimi-k2.5": { input: 0.60, output: 2.50 },
    "kimi-k2.6": { input: 0.95, output: 4.00 },
    "kimi-k2-thinking": { input: 0.60, output: 2.50 },
    "kimi-k2-turbo-preview": { input: 1.15, output: 8.00 },
    "kimi-k2-thinking-turbo": { input: 1.15, output: 8.00 },
  };
  const rate = PRICING[KIMI_MODEL] || PRICING["kimi-k2.6"];
  const VISION_RATE = { input: 0.60, output: 2.50 }; // moonshot-v1 pricing approx
  const mainCost = (usage.input_tokens / 1_000_000) * rate.input + (usage.output_tokens / 1_000_000) * rate.output;
  const visionCost = (visionUsage.input_tokens / 1_000_000) * VISION_RATE.input + (visionUsage.output_tokens / 1_000_000) * VISION_RATE.output;
  const totalCost = mainCost + visionCost;

  const tokenSummary = {
    model: KIMI_MODEL,
    input: usage.input_tokens + visionUsage.input_tokens,
    output: usage.output_tokens + visionUsage.output_tokens,
    total: usage.total_tokens + visionUsage.total_tokens,
    estimated_cost_usd: Math.round(totalCost * 10000) / 10000,
  };

  const visionNote = visionUsage.total_tokens > 0
    ? ` (+vision: ${visionUsage.total_tokens} tokens)`
    : "";
  addLog(`Tokens — in: ${tokenSummary.input}, out: ${tokenSummary.output}, total: ${tokenSummary.total}${visionNote} (~$${tokenSummary.estimated_cost_usd})`);

  if (outputs.length > 0) {
    updateStatus({
      status: "done",
      step: "Termine",
      progress: 100,
      message: `${outputs.length} fichier(s) produit(s)`,
      outputs,
      tokens: tokenSummary,
    });
    addLog("Pipeline termine avec succes");
    console.log(`[WORKER ${jobId}] Done! ${outputs.length} output(s)`);
    process.exit(0);
  } else {
    updateStatus({
      status: "error",
      step: "Erreur",
      progress: 100,
      message: "Aucun fichier produit. Le pipeline n'a pas genere de sortie.",
      outputs: [],
      tokens: tokenSummary,
    });
    addLog("Echec: aucun fichier produit");
    process.exit(1);
  }
}

main().catch((err) => {
  writeError(err.message || "Unknown fatal error");
  console.error(`[WORKER ${jobId}] Fatal:`, err);
  process.exit(1);
});
