import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { TOOLS } from "./tools";
import { handleToolCall } from "./tool-handlers";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `Tu es un assistant montage video professionnel. Tu recois des videos uploadees par l'utilisateur et un prompt decrivant le montage souhaite. Tu utilises les outils disponibles pour produire les videos finales.

## Regles OBLIGATOIRES

### Decoupe
1. TOUJOURS transcrire avec transcribe_video AVANT de couper. Ne JAMAIS estimer les timestamps.
2. Analyser la transcription pour reperer faux departs, doublons, silences morts.
3. Isoler uniquement la meilleure prise complete.
4. Marges de coupe :
   - Debut : 0.1s avant le premier mot
   - Fin : 0.5-0.6s apres le dernier mot Whisper
   - CRITIQUE — si le segment est suivi de silence (text frame, noir) : 0.7-1.0s minimum
5. Si la duree d'un segment depasse 2x la duree attendue = doublon probable, re-analyser.

### Assemblage
- TOUJOURS utiliser le concat filter (via cut_video ou concat_videos)
- JAMAIS de concat demuxer (-f concat) — double encodage AAC = artefacts audio

### Rythme (format Reels)
- Entre segments : max 0.2-0.3s de silence
- Pauses intra-replique > 1s : les couper
- Ne JAMAIS couper les mots, uniquement les silences
- Gap scanning : apres transcription, scanner les gaps > 0.5s entre word.end et next_word.start

### Qualite
- Codec : -c:v libx264 -crf 18 -r 30000/1001
- Audio : -c:a aac -ar 48000 -ac 2
- Ne JAMAIS ecraser les fichiers source

### Sous-titres (style Hormozi par defaut)
- Font : Big Shoulders Display Black, 90px, MAJUSCULES
- Mot actif : couleur accent + scale 110%
- Outline : 5px noir, shadow 2px
- Couleur accent : extraire couleur saturee du decor video (frame ~3s)

### Text frame (ecran de fin)
- Fond noir 1080x1920, 4s, 30fps
- Lignes blanches sauf punchline en couleur accent
- Fleche animee + CTA "LIS LA DESCRIPTION"

### Description Instagram
- Texte percutant, direct, avec emojis en fin de paragraphe
- Terminer par "Tu te reconnais ? 👇"
- 10 hashtags thematiques

## Pipeline standard
1. Transcrire chaque clip source
2. Analyser la transcription : faux departs, doublons, meilleure prise
3. Couper les segments via cut_video (concat filter)
4. Supprimer les silences via remove_silence
5. Extraire la couleur accent du decor
6. Bruler les sous-titres via burn_subtitles
7. Generer le text frame via generate_text_frame
8. Concatener video sous-titree + text frame via concat_videos
9. Enregistrer chaque deliverable avec save_output

## IMPORTANT
- Pour chaque fichier delivrable final, appelle save_output avec un label clair et une description si pertinent.
- Si le prompt demande plusieurs videos (ex: 6 reels), produis chacune separement et appelle save_output pour chacune.
- Utilise le repertoire de travail fourni pour les fichiers intermediaires.
- Les videos uploadees sont dans le dossier input/ du job.`;

interface JobStatus {
  status: "processing" | "done" | "error";
  step: string;
  progress: number;
  message: string;
  outputs: { file: string; label: string; description: string }[];
  log: string[];
}

function updateStatus(jobDir: string, updates: Partial<JobStatus>) {
  const statusPath = path.join(jobDir, "status.json");
  let status: JobStatus = {
    status: "processing",
    step: "",
    progress: 0,
    message: "",
    outputs: [],
    log: [],
  };

  if (fs.existsSync(statusPath)) {
    status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
  }

  Object.assign(status, updates);
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

function addLog(jobDir: string, message: string) {
  const statusPath = path.join(jobDir, "status.json");
  let status: JobStatus = {
    status: "processing",
    step: "",
    progress: 0,
    message: "",
    outputs: [],
    log: [],
  };

  if (fs.existsSync(statusPath)) {
    status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
  }

  status.log.push(`[${new Date().toISOString()}] ${message}`);
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

export async function runAgent(
  jobId: string,
  prompt: string,
  videoFileNames: string[],
  style: string,
  accentColor?: string
) {
  const jobDir = path.join(process.cwd(), "jobs", jobId);
  const inputDir = path.join(jobDir, "input");
  const workDir = path.join(jobDir, "work");
  fs.mkdirSync(workDir, { recursive: true });

  // Build the user message with context about uploaded files
  const videoPaths = videoFileNames.map((f) => path.join(inputDir, f));
  const videoList = videoPaths
    .map((p, i) => `- Video ${i + 1}: ${p}`)
    .join("\n");

  const styleInfo = style ? `\nStyle de sous-titres demande: ${style}` : "";
  const colorInfo = accentColor
    ? `\nCouleur accent fournie: ${accentColor}`
    : "\nCouleur accent: a extraire automatiquement du decor de la video (frame ~3s)";

  const userMessage = `Voici les videos uploadees:
${videoList}

Repertoire de travail pour fichiers intermediaires: ${workDir}
${styleInfo}${colorInfo}

## Prompt de l'utilisateur:
${prompt}`;

  updateStatus(jobDir, {
    status: "processing",
    step: "Initialisation",
    progress: 5,
    message: "Demarrage du pipeline...",
    log: [`Demarrage avec ${videoFileNames.length} video(s)`],
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let iterationCount = 0;
  const maxIterations = 50;

  while (iterationCount < maxIterations) {
    iterationCount++;

    addLog(jobDir, `Iteration ${iterationCount} — appel Claude API`);

    let response: Anthropic.Message;
    try {
      const client = getClient();
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
    } catch (apiError: unknown) {
      const err = apiError as Error;
      addLog(jobDir, `ERREUR API Claude: ${err.message}`);
      updateStatus(jobDir, {
        status: "error",
        step: "Erreur",
        message: `Erreur API Claude: ${err.message}`,
      });
      return;
    }

    addLog(jobDir, `Reponse Claude: ${response.content.length} blocs, stop=${response.stop_reason}`);

    // Process the response
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    // Check if there are tool calls
    const toolUses = assistantContent.filter(
      (block) => block.type === "tool_use"
    );

    if (toolUses.length === 0) {
      // No tool calls = agent is done
      const textBlocks = assistantContent.filter(
        (block) => block.type === "text"
      ) as Anthropic.TextBlock[];
      const finalMessage =
        textBlocks.map((b) => b.text).join("\n") || "Montage termine.";

      // Read outputs manifest
      const outputsPath = path.join(jobDir, "outputs.json");
      const outputs = fs.existsSync(outputsPath)
        ? JSON.parse(fs.readFileSync(outputsPath, "utf-8"))
        : [];

      updateStatus(jobDir, {
        status: "done",
        step: "Termine",
        progress: 100,
        message: finalMessage,
        outputs,
      });

      addLog(jobDir, "Pipeline termine avec succes");
      return;
    }

    // Execute tool calls and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      const toolName = (toolUse as { name: string }).name;
      const toolInput = (toolUse as { input: Record<string, unknown> }).input;
      const toolId = (toolUse as { id: string }).id;

      addLog(jobDir, `Outil: ${toolName}(${JSON.stringify(toolInput).slice(0, 200)})`);
      updateStatus(jobDir, {
        step: getStepLabel(toolName),
        message: `Execution: ${toolName}...`,
        progress: getProgress(toolName),
      });

      let result;
      try {
        result = await handleToolCall(toolName, toolInput, jobDir);
      } catch (toolError: unknown) {
        const err = toolError as Error;
        result = { success: false, result: "", error: err.message };
      }

      addLog(
        jobDir,
        result.success
          ? `${toolName} OK: ${result.result.slice(0, 200)}`
          : `${toolName} ERREUR: ${result.error}`
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolId,
        content: result.success
          ? result.result
          : `Error: ${result.error}`,
        is_error: !result.success,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Max iterations reached
  updateStatus(jobDir, {
    status: "error",
    step: "Erreur",
    progress: 0,
    message:
      "Le pipeline a depasse le nombre maximum d'iterations. Le montage est peut-etre trop complexe pour un seul passage.",
  });
}

function getStepLabel(toolName: string): string {
  const labels: Record<string, string> = {
    transcribe_video: "Transcription",
    cut_video: "Decoupe",
    burn_subtitles: "Sous-titres",
    generate_text_frame: "Text frame",
    concat_videos: "Assemblage",
    extract_frame: "Extraction frame",
    get_video_info: "Analyse video",
    remove_silence: "Suppression silences",
    save_output: "Sauvegarde",
  };
  return labels[toolName] || toolName;
}

function getProgress(toolName: string): number {
  const progress: Record<string, number> = {
    get_video_info: 10,
    transcribe_video: 20,
    cut_video: 40,
    remove_silence: 50,
    extract_frame: 55,
    burn_subtitles: 65,
    generate_text_frame: 80,
    concat_videos: 90,
    save_output: 95,
  };
  return progress[toolName] || 50;
}
