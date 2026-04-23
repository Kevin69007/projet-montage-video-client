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

// --- System prompt (robust, examples-driven) ---

function buildSystemPrompt(ffmpegPath) {
  const stylesJson = fs.readFileSync(path.join(PIPELINE_DIR, "styles.json"), "utf-8");

  return `# IDENTITE
Tu es un agent AUTONOME de montage video professionnel. Tu executes les commandes, tu ne poses JAMAIS de questions. Si quelque chose manque, tu fais un choix raisonnable et tu continues.

# OUTILS — QUAND UTILISER CHACUN

## Bash (outil principal)
Pour executer des commandes shell. UTILISE Bash pour :
- Lancer \`ffprobe\`, \`ffmpeg\` (analyse, coupe, concat)
- Lancer les scripts Python : transcribe.py, burn_subtitles.py, generate_text_frame.py, generate_thumbnail.py
- Lancer \`nano-banana\` (generation IA miniatures)
- \`ls\`, \`cp\`, \`mkdir\`, \`cat\` (operations fichiers)

NE JAMAIS utiliser Bash pour creer outputs.json → utilise Write.

## Read
Pour lire le contenu d'un fichier. UTILISE Read pour :
- Lire une transcription JSON apres transcribe.py (indispensable avant de planifier les coupes)
- Lire styles.json si besoin
- Lire une image (retourne une description automatique)

Ne pas utiliser Read sur des gros fichiers video (trop lourd).

## Write
Pour ecrire/creer un fichier. UTILISE Write UNIQUEMENT pour :
- outputs.json final (OBLIGATOIRE a la fin)
- Fichiers texte ou JSON intermediaires si besoin

NE JAMAIS utiliser Write pour generer des videos/images/audio → utilise Bash + ffmpeg/scripts.

# REGLE D'OR
A la FIN de la tache, tu DOIS appeler Write sur outputs.json avec un tableau JSON valide.
Format : [{"file": "nom.mp4", "label": "Titre", "description": "Description Instagram"}]
Sans outputs.json valide, tout le travail est perdu.

# SCRIPTS DISPONIBLES — COMMANDES EXACTES

## 1. Transcription (Whisper local)
\`\`\`bash
python3 "${SCRIPTS_DIR}/transcribe.py" --video "<chemin_video>" --output "<chemin_sortie.json>" --language fr
\`\`\`
Produit : JSON avec \`{type:"word", word, start, end}\` et \`{type:"silence", start, end, duration}\`.
Duree typique : 1-3 min par minute de video.

## 2. Sous-titres Hormozi / variantes
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/burn_subtitles.py" \\
  "<video.mp4>" "<transcription.json>" "<accent_hex>" "<output.mp4>" <font_size> <wpl> <lines>
\`\`\`
Exemple concret :
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/burn_subtitles.py" \\
  "/app/jobs/abc/work/cut.mp4" "/app/jobs/abc/work/cut_transcription.json" "#FFD700" "/app/jobs/abc/work/final.mp4" 80 5 2
\`\`\`

Pour le style Cove (dual-font) :
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/burn_subtitles_cove.py" \\
  "<video>" "<transcription.json>" "<output>" "<accent_hex>" <font_size> <wpl> <lines>
\`\`\`

## 3. Text frame (ecran de fin 4s, 1080x1920)
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/generate_text_frame.py" \\
  "LIGNE1|LIGNE2|PUNCHLINE" <punchline_index> "<output.mp4>" "<accent_color>" <font_size>
\`\`\`

## 4. FFmpeg — coupe avec concat FILTER (JAMAIS demuxer)
Exemple pour couper 2 segments :
\`\`\`bash
ffmpeg -y \\
  -ss 5.0 -to 12.5 -i "/app/jobs/abc/input/video.mp4" \\
  -ss 42.1 -to 58.3 -i "/app/jobs/abc/input/video.mp4" \\
  -filter_complex "[0:v]setpts=PTS-STARTPTS[v0];[0:a]asetpts=PTS-STARTPTS[a0];[1:v]setpts=PTS-STARTPTS[v1];[1:a]asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]" \\
  -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 \\
  "/app/jobs/abc/work/cut.mp4"
\`\`\`

Format 9:16 : ajouter apres concat :
\`;[outv]crop=ih*9/16:ih[cr];[cr]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[outv2]\` et mapper [outv2].

Format 1:1 :
\`;[outv]crop=min(iw\\,ih):min(iw\\,ih)[cr];[cr]scale=1080:1080[outv2]\`

## 5. Extraction de frame (pour miniatures)
\`\`\`bash
ffmpeg -y -ss 12.5 -i "<video>" -frames:v 1 "<output.jpg>"
\`\`\`

## 6. nano-banana (generation miniatures IA via Gemini)
\`\`\`bash
nano-banana "<description detaillee>" -r "<reference.jpg>" -r "<frame.jpg>" -o "<nom>" -s 1K -a <format> -d "<output_dir>"
\`\`\`

## 7. Concat video + text frame
\`\`\`bash
ffmpeg -y -i "video.mp4" -i "text_frame.mp4" \\
  -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" \\
  -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -c:a aac "final.mp4"
\`\`\`

# STYLES SOUS-TITRES
${stylesJson}

# PIPELINE VIDEO — SEQUENCE OBLIGATOIRE

Pour un TEASER ou REEL :

\`\`\`
ETAPE 1 : Analyser la video
  Bash : ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "<video>"

ETAPE 2 : Transcrire l'original
  Bash : python3 transcribe.py --video "<input>" --output "<work>/orig.json" --language fr

ETAPE 3 : Lire la transcription pour planifier
  Read : "<work>/orig.json"
  Analyser : phrases completes (finissant par . ! ?), hook fort, moments marquants
  Calculer : total = sum(end - start) de tes segments. DOIT etre <= duree_cible + 3s

ETAPE 4 : Couper la video (concat FILTER, jamais demuxer)
  Bash : ffmpeg avec les segments choisis + crop si format 9:16

ETAPE 5 : ⚠️ RE-TRANSCRIRE LA VIDEO COUPEE (pas l'originale !)
  Bash : python3 transcribe.py --video "<work>/cut.mp4" --output "<work>/cut.json" --language fr

ETAPE 6 : Bruler les sous-titres avec la NOUVELLE transcription
  Bash : burn_subtitles.py sur cut.mp4 avec cut.json

ETAPE 7 (optionnel) : Generer text frame + concat
  Bash : generate_text_frame.py puis ffmpeg concat

ETAPE 8 : Copier vers output + ecrire outputs.json
  Bash : cp "<work>/final.mp4" "<output_dir>/"
  Write : outputs.json avec [{"file":"final.mp4","label":"...","description":"..."}]
\`\`\`

# REGLES DE COUPE CRITIQUES

- Debut segment : 0.1s AVANT le premier mot (pas au debut pile)
- Fin segment : 0.5-0.6s APRES le dernier mot (sinon le son est coupe)
- Fin avant silence/text frame : 0.7-1.0s minimum
- Entre segments : max 0.2-0.3s de silence
- CHAQUE segment doit commencer ET finir sur une phrase complete (. ! ? ou pause > 0.5s)
- NE JAMAIS couper au milieu d'un mot
- Duree totale : respect strict de la cible (+/- 3s max)
- Toujours utiliser concat FILTER (-filter_complex), JAMAIS -f concat (demuxer)

# DESCRIPTION INSTAGRAM (pour le champ description de outputs.json)

- Accrocheuse, 3-4 paragraphes courts
- Emojis a la fin des paragraphes
- Terminer par "Tu te reconnais ?"
- 10 hashtags thematiques en fin

# MODE MINIATURE (THUMBNAIL)

Si le mode est "miniature", tu produis des IMAGES (pas des videos).

## Pipeline miniature
1. Analyser la reference : tu la vois dans le message utilisateur. Identifie :
   - Couleurs dominantes (background, texte, accents)
   - Typographie (style, taille, position)
   - Composition (ou est le sujet, ou est le texte)
   - Elements decoratifs (bordures, arrows, emojis, badges)
   - Mood (bold, minimaliste, playful, corporate)

2. Extraire 5-8 frames candidates :
\`\`\`bash
ffmpeg -y -ss 5 -i "<video>" -frames:v 1 "<work>/frame_5s.jpg"
ffmpeg -y -ss 15 -i "<video>" -frames:v 1 "<work>/frame_15s.jpg"
# etc, a des moments varies
\`\`\`

3. Pour chaque miniature demandee, appeler nano-banana avec un prompt TRES DETAILLE :

Miniature 1 (fidele a la reference) :
\`\`\`bash
nano-banana "YouTube thumbnail matching the reference style EXACTLY. [Couleurs specifiques: background #XXX, text #YYY, accents #ZZZ]. [Typographie: bold sans-serif, large centered]. [Layout: subject on right, text on left]. Use the person from the second reference image, same expression. Keep the exact visual identity of the reference." \\
  -r "<reference>" -r "<meilleure_frame>" \\
  -o "miniature_1" -s 1K -a <format> -d "<output_dir>"
\`\`\`

Miniature 2 (variante creative) :
\`\`\`bash
nano-banana "YouTube thumbnail inspired by the reference. Keep the color palette [#XXX, #YYY, #ZZZ] and overall mood. But use a different layout, different pose for the subject, bolder text. More dynamic composition." \\
  -r "<reference>" -r "<autre_frame>" \\
  -o "miniature_2" -s 1K -a <format> -d "<output_dir>"
\`\`\`

4. Ecrire outputs.json avec tous les fichiers generes.

# GESTION D'ERREURS

Si une commande echoue :
- Lire le message d'erreur attentivement
- Si "not found" → utiliser \`ls\` pour trouver le vrai chemin
- Si syntax error → revoir les guillemets/echappements
- Si ffmpeg error → simplifier le filter_complex, tester input avec ffprobe
- Ne JAMAIS relancer la meme commande sans changement

# FINALISATION OBLIGATOIRE

Quand tu as produit au moins un fichier dans output/, tu DOIS :
1. Appeler Write avec file_path="<outputs_json_path>" et content=JSON.stringify([...])
2. Le JSON doit etre un tableau d'objets : {"file": "...", "label": "...", "description": "..."}
3. Apres le Write, repondre simplement "Termine" sans appel d'outil supplementaire

C'est la seule facon de signaler que le travail est complet.`;
}

// --- User prompt builders ---

function buildUserPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath, referenceFile) {
  if (params.mode === "miniature") {
    return buildMiniaturePrompt(params, videoPaths, workDir, outputDir, outputsJsonPath, referenceFile);
  }
  return buildVideoPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath);
}

function buildVideoPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath) {
  const videoList = videoPaths.map((p, i) => `  - Video ${i + 1}: ${p}`).join("\n");
  const durationTarget = params.videoType === "teaser" ? params.duration : null;

  let styleConfig = {};
  try {
    const styles = JSON.parse(fs.readFileSync(path.join(PIPELINE_DIR, "styles.json"), "utf-8"));
    styleConfig = styles[params.style] || {};
  } catch (_) {}
  const accent = params.accentColor || styleConfig.accentColor || "#FFD700";
  const fontSize = styleConfig.size || 80;
  const wpl = styleConfig.wordsPerLine || 5;

  return `# TACHE : MONTAGE VIDEO

## Parametres
- Mode : ${params.videoType || "teaser"}
${durationTarget ? `- Duree cible : ${durationTarget}s MAXIMUM (strict +/- 3s)` : ""}
- Format : ${params.format || "9:16"}${params.format === "9:16" ? " (vertical Reels — utiliser crop 9:16)" : ""}
- Style sous-titres : ${params.style} (accent: ${accent}, taille: ${fontSize}px, mots/ligne: ${wpl})
- Langue : ${params.language || "fr"}

## Fichiers
- Videos source :
${videoList}
- Repertoire de travail : ${workDir}
- Repertoire de sortie : ${outputDir}
- Manifest a ecrire : ${outputsJsonPath}

## Prompt utilisateur
${params.prompt}

## CRITERES DE SUCCES
- [ ] Au moins 1 fichier .mp4 dans ${outputDir}/
- [ ] outputs.json existe et contient un tableau JSON non-vide
- [ ] ${durationTarget ? `Duree du reel <= ${durationTarget + 3}s` : "Duree respecte le prompt"}
- [ ] Sous-titres synchronises avec l'audio FINAL (re-transcription de la video coupee)
- [ ] Description Instagram complete dans outputs.json

## DEMARRAGE
1. Verifier les fichiers d'input avec \`ls "${path.dirname(videoPaths[0] || "")}"\`
2. Commencer par ffprobe puis transcribe.py sur l'original
3. Lire la transcription JSON avec Read AVANT de decider des coupes
4. Suivre la sequence du pipeline (voir system prompt)
5. Terminer par Write sur outputs.json`;
}

function buildMiniaturePrompt(params, videoPaths, workDir, outputDir, outputsJsonPath, referenceFile) {
  // Separate video files from reference image
  const inputDir = path.join(jobDir, "input");
  const videoFiles = [];
  for (const f of params.fileNames) {
    const full = path.join(inputDir, f);
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(f)) {
      videoFiles.push(full);
    } else if (full !== referenceFile) {
      videoFiles.push(full);
    }
  }

  const videoList = videoFiles.map((p, i) => `  - Video ${i + 1}: ${p}`).join("\n");

  return `# TACHE : GENERATION MINIATURES IA

## Parametres
- Nombre de miniatures : ${params.thumbnailCount || 2}
- Format : ${params.thumbnailFormat || "16:9"}
- Texte a inclure : ${params.thumbnailText ? `"${params.thumbnailText}"` : "aucun (juste visuel)"}
- Couleur accent : ${params.accentColor || "auto"}

## Fichiers
- Video(s) source (pour extraire des frames) :
${videoList}
- Image de reference : ${referenceFile}
  (tu la vois directement dans ce message — analyse-la visuellement)
- Repertoire de travail (frames) : ${workDir}
- Repertoire de sortie : ${outputDir}
- Manifest a ecrire : ${outputsJsonPath}

## Prompt utilisateur
${params.prompt}

## CRITERES DE SUCCES
- [ ] ${params.thumbnailCount || 2} fichiers .jpg/.png dans ${outputDir}/
- [ ] Miniature 1 reproduit FIDELEMENT le style visuel de la reference (couleurs, layout, typographie)
- [ ] Miniature 2 est une variante creative (meme palette, composition differente)
- [ ] outputs.json valide avec tous les fichiers

## DEMARRAGE (etapes obligatoires)
1. Analyser la reference visuellement (regarde l'image ci-jointe) :
   - Liste les 3 couleurs principales (hex si possible)
   - Decris la typographie (police, taille, position, couleur)
   - Decris le layout (ou est le sujet, ou est le texte, decorations)
   - Decris le mood (bold / minimaliste / playful / corporate)

2. Extraire 5-8 frames varies de la video avec ffmpeg -ss

3. Selectionner les 2 meilleures frames (expressions fortes, bon cadrage)

4. Generer avec nano-banana en INCLUANT l'analyse de style dans le prompt (pas juste "make a thumbnail")

5. Verifier que les fichiers existent dans output/

6. Ecrire outputs.json`;
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

async function describeImage(filePath) {
  try {
    const imgBuffer = fs.readFileSync(filePath);
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
              { type: "text", text: "Decris cette image avec un MAXIMUM de details, en francais :\n\n1. COULEURS : liste les 3-5 couleurs dominantes avec codes hex approximatifs (background, texte, accents).\n2. TYPOGRAPHIE : police (sans-serif / serif / display), taille relative, couleur, position, outline/shadow/glow.\n3. COMPOSITION : ou est le sujet principal ? ou est le texte ? left/right/center/top/bottom.\n4. ELEMENTS DECORATIFS : bordures, flecheurs, emojis, badges, formes geometriques, cadres incline.\n5. MOOD : bold / minimaliste / playful / corporate / gaming / food.\n6. SUJET : quelle personne/objet est mis en avant.\n\nSois TRES precis pour que quelqu'un puisse reproduire le style." }
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
    const description = data.choices?.[0]?.message?.content || "(no description)";
    return `[Analyse detaillee de ${path.basename(filePath)}]\n${description}`;
  } catch (err) {
    return `[Image ${path.basename(filePath)} — ${err.message}]`;
  }
}

// --- Coaching on tool errors ---

function coachOnError(toolName, result) {
  if (!String(result).startsWith("ERROR")) return result;
  let hint = "";
  const r = String(result);
  if (r.includes("not found") || r.includes("No such file")) {
    hint = "\n\n[ASTUCE] Utilise Bash avec `ls \"<chemin_parent>\"` pour verifier les fichiers presents, puis corrige le chemin.";
  } else if (r.includes("timed out") || r.includes("ETIMEDOUT")) {
    hint = "\n\n[ASTUCE] Commande trop longue. Augmente le timeout ou decompose en sous-etapes.";
  } else if (toolName === "Bash" && (r.includes("Invalid argument") || r.includes("Unable to parse"))) {
    hint = "\n\n[ASTUCE] Verifie la syntaxe de la commande, notamment les guillemets autour des chemins.";
  } else if (toolName === "Bash" && r.includes("ffmpeg")) {
    hint = "\n\n[ASTUCE] Pour un ffmpeg error, verifie : (1) l'input existe avec ls, (2) le filter_complex est bien forme, (3) les labels de stream ([v0], [a0]) correspondent.";
  } else if (r.includes("concat")) {
    hint = "\n\n[ASTUCE] Utilise le concat FILTER (-filter_complex \"...concat=n=...\"), JAMAIS le concat demuxer (-f concat).";
  } else if (toolName === "Write" && r.includes("ENOENT")) {
    hint = "\n\n[ASTUCE] Le repertoire parent n'existe pas. Cree-le d'abord avec Bash: `mkdir -p <dir>`.";
  }
  return r + hint;
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
      const isTransient = [429, 500, 502, 503, 504].includes(err.status);
      if (isTransient && attempt < API_RETRIES - 1) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        addLog(`API ${err.status} — retry ${attempt + 1}/${API_RETRIES} dans ${backoff / 1000}s`);
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

  const params = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
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

  const systemPrompt = buildSystemPrompt(ffmpegPath);
  const userPromptText = buildUserPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath, referenceFile);

  // Task summary for context re-injection
  const taskSummary = params.mode === "miniature"
    ? `mode=miniature, ${params.thumbnailCount || 2} miniatures, format=${params.thumbnailFormat || "16:9"}, reference=${referenceFile ? path.basename(referenceFile) : "none"}`
    : `mode=video, type=${params.videoType || "teaser"}, duree max=${params.duration || 30}s, format=${params.format || "9:16"}, style=${params.style}, langue=${params.language || "fr"}`;

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

  const toolEnv = {
    PATH: `${path.join(process.env.HOME || "", ".local", "bin")}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    FFMPEG_PATH: ffmpegPath,
    FONTS_DIR: FONTS_DIR,
  };

  let lastProgress = 5;
  let iteration = 0;
  let outputsJsonReminderCount = 0;
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[WORKER ${jobId}] Iteration ${iteration}/${MAX_ITERATIONS}`);

    // Context re-injection every N iterations
    if (iteration > 1 && iteration % CONTEXT_REMINDER_EVERY === 0) {
      messages.push({
        role: "user",
        content: `[RAPPEL — iteration ${iteration}/${MAX_ITERATIONS}] Verifie que tu respectes toujours : ${taskSummary}. N'oublie pas d'ecrire outputs.json a la fin.`,
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
    if (!choice) {
      addLog("Pas de reponse de Kimi");
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
          if (Array.isArray(content) && content.length > 0) valid = true;
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
          content: `[VERIFICATION MANQUANTE] Tu n'as pas ecrit outputs.json (ou il est vide). C'est OBLIGATOIRE pour terminer.

${existingFiles.length > 0 ? `Fichiers deja presents dans ${outputDir}/ :\n${existingFiles.map(f => `  - ${f}`).join("\n")}\n` : `Aucun fichier dans ${outputDir}/ pour l'instant — tu dois d'abord copier tes livrables la-bas avec Bash 'cp'.\n`}

Utilise l'outil Write MAINTENANT :
- file_path : "${outputsJsonPath}"
- content : un JSON array comme : [{"file":"nom.mp4","label":"Titre court","description":"Description Instagram longue avec emojis et hashtags"}]

Apres le Write, reponds juste "Termine" sans autre appel d'outil.`,
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
        const cmd = args.command || "";
        const shortCmd = cmd.length > 150 ? cmd.slice(0, 150) + "..." : cmd;
        addLog(`Bash: ${shortCmd}`);
        const progress = detectProgress(cmd);
        if (progress && progress.progress > lastProgress) {
          lastProgress = progress.progress;
          updateStatus(progress);
        }
        result = execBash(cmd, args.timeout || 1800, toolEnv);
      } else if (fnName === "Read") {
        const fp = args.file_path || "";
        addLog(`Read: ${fp}`);
        result = await execRead(fp);
      } else if (fnName === "Write") {
        const fp = args.file_path || "";
        const contentLen = (args.content || "").length;
        addLog(`Write: ${fp} (${contentLen} chars)`);
        result = execWrite(fp, args.content || "");
        // Detect outputs.json write for progress
        if (fp === outputsJsonPath) {
          updateStatus({ step: "Sauvegarde", progress: 95, message: "outputs.json ecrit..." });
        }
      } else {
        result = `ERROR: Unknown tool: ${fnName}`;
      }

      // Coach on errors
      const finalResult = coachOnError(fnName, result);

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
  const estCost = (usage.input_tokens / 1_000_000) * rate.input + (usage.output_tokens / 1_000_000) * rate.output;

  const tokenSummary = {
    model: KIMI_MODEL,
    input: usage.input_tokens,
    output: usage.output_tokens,
    total: usage.total_tokens,
    estimated_cost_usd: Math.round(estCost * 10000) / 10000,
  };

  addLog(`Tokens — in: ${usage.input_tokens}, out: ${usage.output_tokens}, total: ${usage.total_tokens} (~$${tokenSummary.estimated_cost_usd})`);

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
