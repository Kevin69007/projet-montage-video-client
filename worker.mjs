#!/usr/bin/env node

/**
 * Worker process — runs the Claude agent pipeline independently of Next.js.
 * Spawned as a detached child process by /api/process route.
 *
 * Usage: node worker.mjs <jobId>
 * Reads job params from jobs/<jobId>/params.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up environment
process.chdir(__dirname);

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: node worker.mjs <jobId>");
  process.exit(1);
}

const jobDir = path.join(__dirname, "jobs", jobId);
const statusPath = path.join(jobDir, "status.json");

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

async function main() {
  console.log(`[WORKER ${jobId}] Starting...`);

  // Read job params
  const paramsPath = path.join(jobDir, "params.json");
  if (!fs.existsSync(paramsPath)) {
    writeError(`params.json not found at ${paramsPath}`);
    process.exit(1);
  }

  const params = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
  console.log(`[WORKER ${jobId}] Params loaded: prompt=${params.prompt.slice(0, 50)}..., style=${params.style}, files=${params.fileNames.join(", ")}`);

  // Dynamic import of the agent (TypeScript compiled by Next.js)
  // We need to use the compiled version from .next or re-implement
  // Since worker.mjs runs outside Next.js, we use the Anthropic SDK directly

  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    writeError("ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  console.log(`[WORKER ${jobId}] API key found (${apiKey.slice(0, 10)}...)`);

  const client = new Anthropic({ apiKey, timeout: 120000 });

  // Import tool handlers — these are TypeScript, so we inline the logic
  const { execSync } = await import("child_process");

  const PIPELINE_DIR = path.join(__dirname, "pipeline");
  const SCRIPTS_DIR = path.join(PIPELINE_DIR, "scripts");
  const FONTS_DIR = path.join(PIPELINE_DIR, "fonts");

  function exec(cmd, timeoutMs = 1800000) {
    console.log(`[WORKER ${jobId}] exec: ${cmd.slice(0, 200)}`);
    try {
      return execSync(cmd, {
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          FFMPEG_PATH: process.env.FFMPEG_PATH || "ffmpeg",
          FONTS_DIR: FONTS_DIR,
        },
      }).trim();
    } catch (err) {
      const stderr = (err.stderr || "").trim();
      const lastLines = stderr.split("\n").filter(l => !l.includes("MiB/s") && !l.includes("iB/s") && l.trim()).slice(-5).join("\n");
      throw new Error(lastLines || err.message || "Unknown error");
    }
  }

  // Tool handlers
  function handleToolCall(name, input) {
    const workDir = path.join(jobDir, "work");
    fs.mkdirSync(workDir, { recursive: true });

    console.log(`[WORKER ${jobId}] Tool: ${name}(${JSON.stringify(input).slice(0, 200)})`);

    switch (name) {
      case "transcribe_video": {
        const videoPath = input.video_path;
        const language = input.language || "fr";
        const outputPath = path.join(workDir, `transcription_${Date.now()}.json`);

        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          return { success: false, result: "", error: "OPENAI_API_KEY is not set" };
        }

        // Extract audio (OpenAI API has 25MB limit — audio-only is much smaller)
        const audioPath = path.join(workDir, `audio_${Date.now()}.mp3`);
        console.log(`[WORKER ${jobId}] Extracting audio...`);
        exec(`ffmpeg -y -i "${videoPath}" -vn -ac 1 -ar 16000 -b:a 64k -f mp3 "${audioPath}"`, 300000);

        // Call OpenAI Whisper API
        console.log(`[WORKER ${jobId}] Calling OpenAI Whisper API...`);
        const audioBuffer = fs.readFileSync(audioPath);
        const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.mp3");
        formData.append("model", "whisper-1");
        formData.append("language", language);
        formData.append("response_format", "verbose_json");
        formData.append("timestamp_granularities[]", "word");

        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${openaiKey}` },
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          return { success: false, result: "", error: `OpenAI API error ${res.status}: ${errText.slice(0, 300)}` };
        }

        const data = await res.json();
        console.log(`[WORKER ${jobId}] Whisper API response: ${data.words?.length || 0} words`);

        // Transform to [{word, start, end}] format
        const words = (data.words || []).map(w => ({
          word: w.word.trim(),
          start: w.start,
          end: w.end,
        }));

        fs.writeFileSync(outputPath, JSON.stringify(words, null, 2));

        // Clean up audio file
        try { fs.unlinkSync(audioPath); } catch (_) {}

        return { success: true, result: `Transcription saved to ${outputPath}. Found ${words.length} words. First 5: ${JSON.stringify(words.slice(0, 5))}` };
      }
      case "cut_video": {
        const segments = input.segments;
        if (!segments || segments.length === 0) return { success: false, result: "", error: "No segments provided" };
        const inputs = segments.map(s => `-ss ${s.start} -to ${s.end} -i "${input.input_path}"`).join(" ");
        const filterParts = segments.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`).join(";");
        const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
        const filterComplex = `${filterParts};${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;
        const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
        exec(`${ffmpeg} -y ${inputs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${input.output_path}"`, 600000);
        return { success: true, result: `Video cut into ${segments.length} segments → ${input.output_path}` };
      }
      case "burn_subtitles": {
        const style = input.style || "hormozi";
        const script = style === "cove" ? "burn_subtitles_cove.py" : "burn_subtitles.py";
        const accentColor = input.accent_color || "#6C2BD9";
        const fontSize = input.font_size || 90;
        const wpl = input.words_per_line || 3;
        const maxLines = input.max_lines || 2;
        exec(`python3 "${SCRIPTS_DIR}/${script}" "${input.video_path}" "${input.transcription_path}" "${accentColor}" "${input.output_path}" ${fontSize} ${wpl} ${maxLines}`, 600000);
        return { success: true, result: `Subtitles (${style}) burned → ${input.output_path}` };
      }
      case "generate_text_frame": {
        const linesStr = input.lines.join("|");
        const accentColor = input.accent_color || "#EB3223";
        const fontSize = input.font_size || 100;
        exec(`python3 "${SCRIPTS_DIR}/generate_text_frame.py" "${linesStr}" ${input.punchline_index} "${input.output_path}" "${accentColor}" ${fontSize}`, 120000);
        return { success: true, result: `Text frame → ${input.output_path}` };
      }
      case "concat_videos": {
        const videoPaths = input.video_paths;
        if (!videoPaths || videoPaths.length === 0) return { success: false, result: "", error: "No videos provided" };
        if (videoPaths.length === 1) { fs.copyFileSync(videoPaths[0], input.output_path); return { success: true, result: `Copied → ${input.output_path}` }; }
        const vinputs = videoPaths.map(p => `-i "${p}"`).join(" ");
        const filterParts = videoPaths.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`).join(";");
        const concatInputs = videoPaths.map((_, i) => `[v${i}][a${i}]`).join("");
        const filterComplex = `${filterParts};${concatInputs}concat=n=${videoPaths.length}:v=1:a=1[outv][outa]`;
        const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
        exec(`${ffmpeg} -y ${vinputs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${input.output_path}"`, 600000);
        return { success: true, result: `${videoPaths.length} videos concatenated → ${input.output_path}` };
      }
      case "extract_frame": {
        const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
        exec(`${ffmpeg} -y -ss ${input.timestamp} -i "${input.video_path}" -frames:v 1 "${input.output_path}"`);
        return { success: true, result: `Frame at ${input.timestamp}s → ${input.output_path}` };
      }
      case "get_video_info": {
        const result = exec(`ffprobe -v quiet -print_format json -show_format -show_streams "${input.video_path}"`);
        const info = JSON.parse(result);
        const vs = info.streams?.find(s => s.codec_type === "video");
        const as_ = info.streams?.find(s => s.codec_type === "audio");
        return { success: true, result: JSON.stringify({ duration: parseFloat(info.format?.duration || "0"), size_mb: (parseFloat(info.format?.size || "0") / 1024 / 1024).toFixed(1), width: vs?.width, height: vs?.height, fps: vs?.r_frame_rate, video_codec: vs?.codec_name, audio_codec: as_?.codec_name }, null, 2) };
      }
      case "remove_silence": {
        const transcription = JSON.parse(fs.readFileSync(input.transcription_path, "utf-8"));
        const words = transcription.filter(w => (!w.type || w.type === "word") && (w.word || w.text));
        if (words.length === 0) return { success: false, result: "", error: "No words found" };
        const segments = []; let segStart = words[0].start, segEnd = words[0].end;
        const gapThreshold = input.gap_threshold || 0.5;
        for (let i = 1; i < words.length; i++) {
          if (words[i].start - segEnd > gapThreshold) { segments.push({ start: Math.max(0, segStart - 0.1), end: segEnd + 0.3 }); segStart = words[i].start; }
          segEnd = words[i].end;
        }
        segments.push({ start: Math.max(0, segStart - 0.1), end: segEnd + 0.6 });
        if (segments.length <= 1) { fs.copyFileSync(input.video_path, input.output_path); return { success: true, result: `No silences. Copied → ${input.output_path}` }; }
        const sinputs = segments.map(s => `-ss ${s.start} -to ${s.end} -i "${input.video_path}"`).join(" ");
        const filterParts = segments.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`).join(";");
        const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
        const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
        exec(`${ffmpeg} -y ${sinputs} -filter_complex "${filterParts};${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${input.output_path}"`, 600000);
        return { success: true, result: `Removed ${segments.length - 1} silence gaps → ${input.output_path}` };
      }
      case "save_output": {
        const outputDir = path.join(jobDir, "output");
        fs.mkdirSync(outputDir, { recursive: true });
        const fileName = path.basename(input.file_path);
        const destPath = path.join(outputDir, fileName);
        if (input.file_path !== destPath) fs.copyFileSync(input.file_path, destPath);
        const manifestPath = path.join(jobDir, "outputs.json");
        const outputs = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf-8")) : [];
        outputs.push({ file: fileName, label: input.label, description: input.description || "" });
        fs.writeFileSync(manifestPath, JSON.stringify(outputs, null, 2));
        return { success: true, result: `Output saved: "${input.label}" → ${fileName}` };
      }
      default:
        return { success: false, result: "", error: `Unknown tool: ${name}` };
    }
  }

  // Status helpers
  function updateStatus(updates) {
    const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf-8")) : { status: "processing", step: "", progress: 0, message: "", outputs: [], log: [] };
    Object.assign(status, updates);
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  }

  function addLog(message) {
    console.log(`[WORKER ${jobId}] ${message}`);
    const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf-8")) : { log: [] };
    status.log = [...(status.log || []), `[${new Date().toISOString()}] ${message}`];
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  }

  const stepLabels = { get_video_info: "Analyse video", transcribe_video: "Transcription", cut_video: "Decoupe", burn_subtitles: "Sous-titres", generate_text_frame: "Text frame", concat_videos: "Assemblage", extract_frame: "Extraction frame", remove_silence: "Suppression silences", save_output: "Sauvegarde" };
  const stepProgress = { get_video_info: 10, transcribe_video: 20, cut_video: 40, remove_silence: 50, extract_frame: 55, burn_subtitles: 65, generate_text_frame: 80, concat_videos: 90, save_output: 95 };

  // System prompt
  const SYSTEM_PROMPT = `Tu es un assistant montage video professionnel. Tu recois des videos uploadees par l'utilisateur et un prompt decrivant le montage souhaite. Tu utilises les outils disponibles pour produire les videos finales.

## Regles OBLIGATOIRES

### Decoupe
1. TOUJOURS transcrire avec transcribe_video AVANT de couper. Ne JAMAIS estimer les timestamps.
2. Analyser la transcription pour reperer faux departs, doublons, silences morts.
3. Isoler uniquement la meilleure prise complete.
4. Marges de coupe: Debut 0.1s avant le premier mot, Fin 0.5-0.6s apres le dernier mot Whisper. Si suivi de silence: 0.7-1.0s minimum.

### Assemblage
- TOUJOURS utiliser le concat filter (via cut_video ou concat_videos)
- JAMAIS de concat demuxer (-f concat)

### Rythme (format Reels)
- Entre segments: max 0.2-0.3s de silence
- Pauses intra-replique > 1s: les couper
- Ne JAMAIS couper les mots, uniquement les silences

### Qualite
- Codec: -c:v libx264 -crf 18 -r 30000/1001
- Audio: -c:a aac -ar 48000 -ac 2

### Sous-titres (style Hormozi par defaut)
- Font: Big Shoulders Display Black, 90px, MAJUSCULES
- Mot actif: couleur accent + scale 110%

### Text frame
- Fond noir 1080x1920, 4s, 30fps
- Punchline en couleur accent

## Pipeline standard
1. Transcrire chaque clip source
2. Analyser la transcription
3. Couper les segments via cut_video
4. Supprimer les silences via remove_silence
5. Bruler les sous-titres via burn_subtitles
6. Generer le text frame via generate_text_frame
7. Concatener video sous-titree + text frame via concat_videos
8. Enregistrer chaque delivrable avec save_output

## IMPORTANT
- Pour chaque fichier delivrable final, appelle save_output.
- Utilise le repertoire de travail fourni pour les fichiers intermediaires.
- Les videos uploadees sont dans le dossier input/ du job.`;

  // Tool definitions
  const TOOLS = [
    { name: "transcribe_video", description: "Transcribe video with Whisper (word-level timestamps).", input_schema: { type: "object", properties: { video_path: { type: "string" }, language: { type: "string" } }, required: ["video_path"] } },
    { name: "cut_video", description: "Cut and assemble segments using FFmpeg concat filter.", input_schema: { type: "object", properties: { input_path: { type: "string" }, segments: { type: "array", items: { type: "object", properties: { start: { type: "number" }, end: { type: "number" } }, required: ["start", "end"] } }, output_path: { type: "string" } }, required: ["input_path", "segments", "output_path"] } },
    { name: "burn_subtitles", description: "Burn styled subtitles (Hormozi/Cove).", input_schema: { type: "object", properties: { video_path: { type: "string" }, transcription_path: { type: "string" }, style: { type: "string", enum: ["hormozi", "cove", "mrbeast", "karaoke", "boxed", "minimal", "neon"] }, accent_color: { type: "string" }, output_path: { type: "string" }, font_size: { type: "number" }, words_per_line: { type: "number" }, max_lines: { type: "number" } }, required: ["video_path", "transcription_path", "style", "accent_color", "output_path"] } },
    { name: "generate_text_frame", description: "Generate animated text frame video (4s, 1080x1920).", input_schema: { type: "object", properties: { lines: { type: "array", items: { type: "string" } }, punchline_index: { type: "number" }, output_path: { type: "string" }, accent_color: { type: "string" }, font_size: { type: "number" } }, required: ["lines", "punchline_index", "output_path"] } },
    { name: "concat_videos", description: "Concatenate videos using FFmpeg concat filter.", input_schema: { type: "object", properties: { video_paths: { type: "array", items: { type: "string" } }, output_path: { type: "string" } }, required: ["video_paths", "output_path"] } },
    { name: "extract_frame", description: "Extract a single frame from video.", input_schema: { type: "object", properties: { video_path: { type: "string" }, timestamp: { type: "number" }, output_path: { type: "string" } }, required: ["video_path", "timestamp", "output_path"] } },
    { name: "get_video_info", description: "Get video metadata.", input_schema: { type: "object", properties: { video_path: { type: "string" } }, required: ["video_path"] } },
    { name: "remove_silence", description: "Remove silence gaps from video.", input_schema: { type: "object", properties: { video_path: { type: "string" }, transcription_path: { type: "string" }, output_path: { type: "string" }, gap_threshold: { type: "number" } }, required: ["video_path", "transcription_path", "output_path"] } },
    { name: "save_output", description: "Register a file as final output for download.", input_schema: { type: "object", properties: { file_path: { type: "string" }, label: { type: "string" }, description: { type: "string" } }, required: ["file_path", "label"] } },
  ];

  // Build user message
  const inputDir = path.join(jobDir, "input");
  const videoPaths = params.fileNames.map(f => path.join(inputDir, f));
  const videoList = videoPaths.map((p, i) => `- Video ${i + 1}: ${p}`).join("\n");
  const workDir = path.join(jobDir, "work");
  fs.mkdirSync(workDir, { recursive: true });

  const userMessage = `Voici les videos uploadees:\n${videoList}\n\nRepertoire de travail: ${workDir}\nStyle: ${params.style}${params.accentColor ? `\nCouleur accent: ${params.accentColor}` : ""}\n\n## Prompt:\n${params.prompt}`;

  updateStatus({ status: "processing", step: "Initialisation", progress: 5, message: "Demarrage du pipeline..." });
  addLog(`Demarrage avec ${params.fileNames.length} video(s)`);

  const messages = [{ role: "user", content: userMessage }];
  let iterationCount = 0;
  const maxIterations = 50;

  while (iterationCount < maxIterations) {
    iterationCount++;
    addLog(`Iteration ${iterationCount} — appel Claude API`);

    let response;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
    } catch (apiError) {
      addLog(`ERREUR API Claude: ${apiError.message}`);
      updateStatus({ status: "error", step: "Erreur", message: `Erreur API: ${apiError.message}` });
      process.exit(1);
    }

    addLog(`Reponse: ${response.content.length} blocs, stop=${response.stop_reason}`);

    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolUses = assistantContent.filter(b => b.type === "tool_use");

    if (toolUses.length === 0) {
      const textBlocks = assistantContent.filter(b => b.type === "text");
      const finalMessage = textBlocks.map(b => b.text).join("\n") || "Montage termine.";
      const outputsPath = path.join(jobDir, "outputs.json");
      const outputs = fs.existsSync(outputsPath) ? JSON.parse(fs.readFileSync(outputsPath, "utf-8")) : [];
      updateStatus({ status: "done", step: "Termine", progress: 100, message: finalMessage, outputs });
      addLog("Pipeline termine avec succes");
      console.log(`[WORKER ${jobId}] Done!`);
      process.exit(0);
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      const toolName = toolUse.name;
      const toolInput = toolUse.input;
      const toolId = toolUse.id;

      updateStatus({ step: stepLabels[toolName] || toolName, message: `Execution: ${toolName}...`, progress: stepProgress[toolName] || 50 });

      let result;
      try {
        result = handleToolCall(toolName, toolInput);
      } catch (toolError) {
        result = { success: false, result: "", error: toolError.message };
      }

      addLog(result.success ? `${toolName} OK: ${result.result.slice(0, 200)}` : `${toolName} ERREUR: ${result.error}`);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolId,
        content: result.success ? result.result : `Error: ${result.error}`,
        is_error: !result.success,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  updateStatus({ status: "error", step: "Erreur", message: "Max iterations reached" });
  process.exit(1);
}

main().catch(err => {
  writeError(err.message || "Unknown fatal error");
  console.error(`[WORKER ${jobId}] Fatal:`, err);
  process.exit(1);
});
