#!/usr/bin/env node

/**
 * Worker process — calls Kimi API (Moonshot AI) to run video editing pipeline.
 * Uses a pay-per-use API key (no Claude subscription needed).
 *
 * Usage: node worker.mjs <jobId>
 * Reads job params from jobs/<jobId>/params.json
 *
 * Required env: KIMI_API_KEY
 * Optional env: KIMI_MODEL (default: kimi-k2.5), GEMINI_API_KEY (for miniatures)
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
const KIMI_MODEL = process.env.KIMI_MODEL || "kimi-k2.5";
const MAX_ITERATIONS = 50;

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

// --- Find ffmpeg-full (with libass for subtitle burning) ---

function findFfmpegFull() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "ffmpeg"; // fallback to standard ffmpeg
}

// --- Build system prompt ---

function buildSystemPrompt(ffmpegPath) {
  const stylesJson = fs.readFileSync(path.join(PIPELINE_DIR, "styles.json"), "utf-8");

  return `Tu es un monteur video professionnel specialise dans le contenu social media (Instagram Reels, TikTok, YouTube Shorts). Tu recois des videos brutes et un prompt. Tu produis des videos montees, pretes a publier.

## MODE AUTONOME
- Ne pose JAMAIS de questions. L'utilisateur ne peut pas repondre.
- Fais les meilleurs choix editoriaux et execute. Adapte-toi au contenu disponible.
- TOUJOURS produire au moins un fichier. Ne JAMAIS terminer sans sauvegarder les outputs.
- Tu as acces aux outils Bash (executer shell), Read (lire fichiers/images), Write (ecrire fichiers).

## OUTILS DISPONIBLES
Tu utilises l'outil Bash pour executer les scripts et commandes :

### 1. Transcription (Whisper local)
\`\`\`bash
python3 "${SCRIPTS_DIR}/transcribe.py" --video <chemin_video> --output <chemin_sortie.json> --language <fr|en>
\`\`\`
- Produit un JSON : [{id, type:"word", word, start, end}, {id, type:"silence", start, end, duration}, ...]
- Utilise le modele Whisper "small". Premier lancement telecharge le modele (~500MB).
- IMPORTANT : la transcription peut prendre 1-3 minutes par minute de video.

### 2. Sous-titres — Hormozi style (et variantes)
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/burn_subtitles.py" <video> <transcription.json> <accent_hex> <output> [font_size] [wpl] [lines]
\`\`\`
- Pour le style Cove (dual-font) :
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/burn_subtitles_cove.py" <video> <transcription.json> <output> [accent_hex] [font_size] [wpl] [lines]
\`\`\`

### 3. Text frame (ecran de fin)
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${FONTS_DIR}" python3 "${SCRIPTS_DIR}/generate_text_frame.py" "LIGNE1|LIGNE2|PUNCHLINE" <punchline_index> <output.mp4> [accent_color] [font_size]
\`\`\`

### 4. FFmpeg direct
- Decoupe : utiliser TOUJOURS le concat FILTER (jamais -f concat demuxer)
- Commande de coupe type :
\`\`\`bash
ffmpeg -y -ss <start1> -to <end1> -i "<video>" -ss <start2> -to <end2> -i "<video>" \\
  -filter_complex "[0:v]setpts=PTS-STARTPTS[v0];[0:a]asetpts=PTS-STARTPTS[a0];[1:v]setpts=PTS-STARTPTS[v1];[1:a]asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]" \\
  -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "<output>"
\`\`\`
- Conversion 9:16 (vertical) : ajouter apres concat : \`;[outv]crop=ih*9/16:ih[cropped];[cropped]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[outv2]\` et mapper [outv2]
- Conversion 1:1 : \`;[outv]crop=min(iw\\,ih):min(iw\\,ih)[cropped];[cropped]scale=1080:1080[outv2]\`
- Info video : \`ffprobe -v quiet -print_format json -show_format -show_streams "<video>"\`

### 5. Extraction de frame
\`\`\`bash
ffmpeg -y -ss <timestamp> -i "<video>" -frames:v 1 "<output.jpg>"
\`\`\`

## STYLES DE SOUS-TITRES DISPONIBLES
${stylesJson}

Pour chaque style, utilise les parametres correspondants (accentColor, size, wordsPerLine) lors de l'appel a burn_subtitles.py.

## METHODE DE TRAVAIL

### Etape 1 — Comprendre le contenu
Apres transcription, ANALYSE le contenu en profondeur :
- Quel est le sujet principal ?
- Quels sont les moments forts (phrases percutantes, revelations, punchlines) ?
- Ou sont les hooks naturels (questions, affirmations choc, debut d'histoire) ?
- Quelles phrases font une bonne FIN (conclusion, punchline, call-to-action) ?

### Etape 2 — Planifier les cuts intelligemment
Pour un TEASER ou REEL :
- **Hook** (0-3s) : La phrase la plus accrocheuse de TOUTE la video. Pas forcement le debut.
- **Corps** (3s-fin-5s) : Les 2-3 meilleurs moments qui donnent envie d'en voir plus. Par IMPACT, pas chronologique.
- **Fin PROPRE** : TOUJOURS couper sur une phrase COMPLETE. Jamais au milieu d'un mot. Marge 0.7-1.0s apres dernier mot.

## REGLES DE COUPE

### Marges obligatoires
- Debut segment : 0.1s avant le premier mot
- Fin segment : 0.5-0.6s apres le dernier mot
- Fin suivie de silence/text frame : 0.7-1.0s minimum

### Rythme Reels
- Entre segments : max 0.2-0.3s de silence
- Pauses > 1s dans le discours : les couper
- Ne JAMAIS couper au milieu d'un mot

### Phrases completes — CRITIQUE
- Chaque segment DOIT commencer et finir sur une phrase complete
- Si le speaker parle encore a la fin du segment : ETENDRE ou RACCOURCIR

## ASSEMBLAGE
- TOUJOURS utiliser le concat filter FFmpeg. JAMAIS le concat demuxer (-f concat).
- Qualite : -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2

## SOUS-TITRES — SYNCHRONISATION CRITIQUE
- Pipeline correct :
  1. Transcrire la video ORIGINALE (pour analyser et choisir les segments)
  2. Couper la video (ffmpeg concat filter)
  3. RE-TRANSCRIRE la video COUPEE (nouveau appel a transcribe.py sur le fichier coupe)
  4. Bruler les sous-titres sur la video coupee avec la NOUVELLE transcription
- Ne JAMAIS utiliser la transcription de l'original sur la video coupee.

## DUREE — REGLE STRICTE
- Si une duree cible est specifiee, la video finale DOIT respecter cette duree (+/- 3 secondes max).
- AVANT de couper, CALCULE la duree totale : somme de (end - start) de chaque segment.
- Si la somme depasse la duree cible, RETIRE des segments ou RACCOURCIS-les.

## TEXT FRAME (ecran de fin)
- Fond noir 1080x1920, 4s, 30fps
- La punchline de la video en couleur accent
- CTA "LIS LA DESCRIPTION" + fleche animee

## DESCRIPTION INSTAGRAM
Pour chaque video produite, generer une description Instagram :
- Texte percutant en phase avec le contenu
- Emojis en fin de paragraphe
- Terminer par "Tu te reconnais ?"
- 10 hashtags thematiques

## TYPES DE MONTAGE

### Teaser / Reel (20-60s)
- Selectionner les 2-4 meilleurs moments
- Commencer par le HOOK le plus fort
- Format vertical : utiliser crop 9:16 dans la commande ffmpeg
- Supprimer silences et hesitations

### Version longue nettoyee
- Garder l'integralite du contenu
- Supprimer faux departs, doublons, silences morts

### Multi-reels (extraire N clips)
- Identifier N passages thematiques distincts
- Chaque clip a son hook + conclusion
- Chaque clip fonctionne independamment

## METHODE DE DECOUPE AVANCEE
1. Transcrire chaque clip source (word_timestamps via transcribe.py)
2. Analyser : faux departs, doublons, meilleure prise
3. Couper serre avec marges (concat filter multi-input)
4. Scanner gaps > 0.5s entre mots — les supprimer via nouveau cut
5. Verifier : segment >5s sans silence = probablement correct ; >2x duree attendue = doublon probable

## PIPELINE COMPLET
1. ffprobe — analyser le fichier source
2. transcribe.py — transcrire l'original (pour analyse)
3. ANALYSER la transcription (dans ta reflexion)
4. ffmpeg concat filter — decouper les segments identifies
5. transcribe.py — RE-TRANSCRIRE la video coupee (pour sync sous-titres)
6. burn_subtitles.py — ajouter sous-titres avec la nouvelle transcription
7. generate_text_frame.py — creer l'ecran de fin (optionnel)
8. ffmpeg concat filter — assembler video + text frame (si genere)
9. SAUVEGARDER chaque fichier final (voir section SAUVEGARDE)

## SAUVEGARDE DES OUTPUTS — OBLIGATOIRE
Pour CHAQUE delivrable produit :
1. Copier le fichier final dans le repertoire output (utilise Bash : \`cp\`)
2. Ecrire le manifeste outputs.json (utilise l'outil Write) :
   Le fichier doit contenir un tableau JSON :
   \`\`\`json
   [
     {"file": "nom_fichier.mp4", "label": "Teaser 30s", "description": "Description Instagram..."},
     {"file": "miniature.jpg", "label": "Miniature", "description": ""}
   ]
   \`\`\`

Tu peux produire PLUSIEURS outputs (2+ videos, miniatures, etc.). Chaque fichier doit avoir son entree dans outputs.json.
TOUJOURS produire au moins un fichier. Ne JAMAIS terminer sans sauvegarder.

Quand tu as termine tout le travail, reponds avec un message texte SANS appel d'outil pour indiquer la fin.

## ERREURS A EVITER
- Ne JAMAIS utiliser les timestamps bruts sans transcrire d'abord
- Marge de fin trop courte (0.2-0.3s) = mots coupes. Minimum 0.5s
- Segment avant silence : utiliser 0.7-1.0s de marge (pas 0.5s)
- Ne JAMAIS utiliser -f concat (demuxer). Toujours le concat FILTER.

## MODE MINIATURE (THUMBNAIL)

Quand le mode est "miniature", tu produis des IMAGES de miniature (thumbnails) pour YouTube/Instagram, PAS des videos.

### Outil principal : nano-banana (generation IA via Gemini)

\`nano-banana\` est un outil CLI qui genere des images avec l'IA (Gemini). Il peut prendre une image de reference pour reproduire son style.

**Commande de base :**
\`\`\`bash
nano-banana "<description detaillee de la miniature>" -r "<reference.jpg>" -r "<frame.jpg>" -o "<nom_sortie>" -s 1K -a <FORMAT> -d "<output_dir>"
\`\`\`

**Parametres :**
- Le PROMPT doit decrire precisement la miniature voulue (style, couleurs, texte, composition)
- \`-r\` : image(s) de reference (style a reproduire) — tu peux en mettre plusieurs
- \`-r\` : tu peux aussi passer la frame extraite de la video comme deuxieme reference
- \`-o\` : nom du fichier de sortie (sans extension)
- \`-s 1K\` : resolution 1024px
- \`-a <FORMAT>\` : ratio (16:9, 9:16, 1:1, 4:5, 4:3)
- \`-d\` : dossier de sortie

### Pipeline miniature
1. **Analyser la video** — Extraire 5-8 frames candidats a des moments cles :
   \`ffmpeg -y -ss <timestamp> -i "<video>" -frames:v 1 "<output.jpg>"\`
   Choisis des moments expressifs : reactions, gestes, emotions, visage.

2. **Analyser l'image de reference** — Lis l'image de reference avec l'outil Read pour comprendre :
   - Le style global (couleurs, fond, ambiance)
   - La composition (placement photo, texte, decorations)
   - Le type de miniature (YouTube food, gaming, vlog, education, etc.)

3. **Generer chaque miniature avec nano-banana** :
   - Miniature 1 (style fidele) :
     \`\`\`bash
     nano-banana "YouTube thumbnail. [DESCRIPTION PRECISE DU STYLE DE LA REFERENCE]. Use the person/subject from the second reference image. [TEXTE SI FOURNI]. Match the exact style, colors, layout, and decorations of the first reference image." -r "<reference.jpg>" -r "<meilleure_frame.jpg>" -o "miniature_1" -s 1K -a <FORMAT> -d "<output_dir>"
     \`\`\`
   - Miniature 2+ (style creatif) :
     \`\`\`bash
     nano-banana "YouTube thumbnail. [VARIANTE CREATIVE INSPIREE DE LA REFERENCE]. Use the person/subject from the second reference image but with a different pose/expression. More creative and bold composition." -r "<reference.jpg>" -r "<autre_frame.jpg>" -o "miniature_2" -s 1K -a <FORMAT> -d "<output_dir>"
     \`\`\`

4. **Sauvegarder** — Les fichiers sont deja dans output_dir via \`-d\`. Ecrire outputs.json.

### Regles miniature
- TOUJOURS utiliser nano-banana pour generer les miniatures (pas Pillow)
- Passer la reference ET une frame video comme references (-r -r)
- Miniature 1 : reproduire fidelement le style de la reference
- Miniature 2+ : variante creative, frame differente
- Resolution : \`-s 1K -a <FORMAT>\` selon le format demande`;
}

// --- Build user prompt ---

function buildUserPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath) {
  if (params.mode === "miniature") {
    return buildMiniaturePrompt(params, videoPaths, workDir, outputDir, outputsJsonPath);
  }
  return buildVideoPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath);
}

function buildVideoPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath) {
  const videoList = videoPaths.map((p, i) => `- Video ${i + 1}: ${p}`).join("\n");
  const durationInfo = params.videoType === "teaser"
    ? `\nDuree cible: ${params.duration} secondes MAXIMUM (STRICT — ne pas depasser de plus de 3s)`
    : "";
  const formatInfo = params.format && params.format !== "original"
    ? `\nFormat: ${params.format} (ajouter crop ${params.format} dans la commande ffmpeg de coupe)`
    : "";

  let styleInfo = `Style sous-titres: ${params.style}`;
  try {
    const styles = JSON.parse(fs.readFileSync(path.join(PIPELINE_DIR, "styles.json"), "utf-8"));
    const cfg = styles[params.style];
    if (cfg) {
      const accent = params.accentColor || cfg.accentColor;
      styleInfo += ` (accent: ${accent}, taille: ${cfg.size}px, mots/ligne: ${cfg.wordsPerLine})`;
    }
  } catch (_) {}

  return `Mode: VIDEO

Voici les videos uploadees :
${videoList}

Repertoire de travail : ${workDir}
Repertoire de sortie : ${outputDir}
Fichier manifeste : ${outputsJsonPath}

Type de montage : ${params.videoType || "teaser"}${durationInfo}${formatInfo}
${styleInfo}
Langue : ${params.language || "fr"}${params.accentColor ? `\nCouleur accent : ${params.accentColor}` : ""}

## INSTRUCTIONS
- Type "${params.videoType}" : ${params.videoType === "teaser" ? `Produis un teaser/reel de MAXIMUM ${params.duration} secondes. Calcule la duree totale AVANT de couper.` : params.videoType === "clean" ? "Nettoie la video complete (supprime silences, faux departs, doublons)." : "Extrais plusieurs clips courts independants avec chacun son hook et sa conclusion."}
- SOUS-TITRES : Apres avoir coupe la video, tu DOIS re-transcrire la VIDEO COUPEE avant de bruler les sous-titres.
- SAUVEGARDE : Copie chaque fichier final dans ${outputDir}/ et ecris le manifeste ${outputsJsonPath}
- Utilise la langue "${params.language || "fr"}" pour la transcription.

## Prompt de l'utilisateur :
${params.prompt}`;
}

function buildMiniaturePrompt(params, videoPaths, workDir, outputDir, outputsJsonPath) {
  const inputDir = path.join(jobDir, "input");

  const videoFiles = [];
  let referenceFile = "";
  for (const f of params.fileNames) {
    if (params.referenceFileName && f.includes(params.referenceFileName.replace(/[^a-zA-Z0-9._-]/g, "_"))) {
      referenceFile = path.join(inputDir, f);
    } else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(f)) {
      if (!referenceFile) referenceFile = path.join(inputDir, f);
    } else {
      videoFiles.push(path.join(inputDir, f));
    }
  }

  const videoList = videoFiles.map((p, i) => `- Video ${i + 1}: ${p}`).join("\n");

  return `Mode: MINIATURE

## Fichiers
Video(s) source :
${videoList}

Image de reference : ${referenceFile}

Repertoire de travail : ${workDir}
Repertoire de sortie : ${outputDir}
Fichier manifeste : ${outputsJsonPath}

## Parametres
Nombre de miniatures a produire : ${params.thumbnailCount || 2}
Format : ${params.thumbnailFormat || "16:9"} (utilise -a ${params.thumbnailFormat || "16:9"} dans nano-banana)${params.thumbnailText ? `\nTexte a ajouter : "${params.thumbnailText}"` : ""}${params.accentColor ? `\nCouleur accent : ${params.accentColor}` : ""}

## INSTRUCTIONS
1. Extrais 5-8 frames de la video a des moments expressifs/interessants (utilise ffmpeg -ss + Bash)
2. Lis l'image de reference avec Read pour comprendre son style visuel
3. Genere chaque miniature avec nano-banana (voir regles)
4. SAUVEGARDE : Copie chaque miniature dans ${outputDir}/ et ecris le manifeste ${outputsJsonPath}

## Prompt de l'utilisateur :
${params.prompt}`;
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

// --- Tool definitions for Kimi API ---

const TOOLS = [
  {
    type: "function",
    function: {
      name: "Bash",
      description: "Execute a shell command. Returns stdout+stderr. Use for running Python scripts, ffmpeg, file operations, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default 1800 = 30min)" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file. For text files returns the content. For images returns a description via the AI (since raw images are too large).",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute file path" }
        },
        required: ["file_path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "Write",
      description: "Write content to a file (creates or overwrites).",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute file path" },
          content: { type: "string", description: "File content" }
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
    // Truncate very long outputs (Kimi has 256K context, but let's be safe)
    const trimmed = output.trim();
    if (trimmed.length > 10000) {
      return trimmed.slice(0, 5000) + "\n\n[...output truncated...]\n\n" + trimmed.slice(-2000);
    }
    return trimmed || "(no output)";
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

function execRead(filePath) {
  if (!fs.existsSync(filePath)) return `ERROR: File not found: ${filePath}`;
  const stats = fs.statSync(filePath);
  if (stats.size > 5 * 1024 * 1024) return `ERROR: File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB)`;

  // Check if image — describe it using Kimi vision
  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(filePath);
  if (isImage) {
    // Return a note — in the main loop we'll handle images separately by sending them as content blocks
    // For simplicity, we describe the image via a Kimi vision call inline
    return describeImage(filePath);
  }

  // Text file
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

// --- Image description via Kimi vision ---

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
        model: "moonshot-v1-128k-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: "Decris cette image en detail : composition, couleurs, fond, elements decoratifs, typographie si texte visible, style visuel global. Sois precis pour permettre la reproduction du style. Reponds en francais." }
            ]
          }
        ],
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return `[Image ${filePath} — vision API error ${res.status}: ${errText.slice(0, 200)}]`;
    }
    const data = await res.json();
    const description = data.choices?.[0]?.message?.content || "(no description)";
    return `[Description de l'image ${path.basename(filePath)}]\n${description}`;
  } catch (err) {
    return `[Image ${filePath} — could not describe: ${err.message}]`;
  }
}

// --- Kimi API call ---

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
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Kimi API error ${res.status}: ${errText.slice(0, 500)}`);
  }
  return res.json();
}

// --- Main ---

async function main() {
  console.log(`[WORKER ${jobId}] Starting...`);

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
  console.log(`[WORKER ${jobId}] Kimi model: ${KIMI_MODEL}`);

  const inputDir = path.join(jobDir, "input");
  const workDir = path.join(jobDir, "work");
  const outputDir = path.join(jobDir, "output");
  const outputsJsonPath = path.join(jobDir, "outputs.json");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const videoPaths = params.fileNames.map(f => path.join(inputDir, f));

  const ffmpegPath = findFfmpegFull();
  console.log(`[WORKER ${jobId}] FFmpeg: ${ffmpegPath}`);

  const systemPrompt = buildSystemPrompt(ffmpegPath);
  const userPrompt = buildUserPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath);

  updateStatus({ status: "processing", step: "Initialisation", progress: 5, message: `Demarrage (${KIMI_MODEL})...` });
  if (params.mode === "miniature") {
    const videoCount = params.fileNames.filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f)).length;
    const imageCount = params.fileNames.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).length;
    addLog(`Mode miniature — ${videoCount} video(s), ${imageCount} image(s) reference`);
  } else {
    addLog(`Demarrage avec ${params.fileNames.length} video(s)`);
  }

  // Build messages array (OpenAI-compatible format)
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Environment for tool execution
  const toolEnv = {
    PATH: `${path.join(process.env.HOME || "", ".local", "bin")}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    FFMPEG_PATH: ffmpegPath,
    FONTS_DIR: FONTS_DIR,
  };

  let lastProgress = 5;
  let iteration = 0;

  // Agentic loop
  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[WORKER ${jobId}] Iteration ${iteration}/${MAX_ITERATIONS}`);

    let response;
    try {
      response = await callKimi(messages);
    } catch (err) {
      addLog(`Erreur Kimi API: ${err.message}`);
      writeError(`Kimi API: ${err.message}`);
      process.exit(1);
    }

    const choice = response.choices?.[0];
    if (!choice) {
      addLog("Pas de reponse de Kimi");
      break;
    }

    const message = choice.message;
    messages.push(message);

    // Log assistant text
    if (message.content) {
      const text = message.content.trim();
      if (text) addLog(`Kimi: ${text.slice(0, 300)}`);
    }

    const toolCalls = message.tool_calls || [];

    // No more tool calls → Kimi is done
    if (toolCalls.length === 0) {
      addLog(`Pipeline termine (${iteration} tours)`);
      break;
    }

    // Execute each tool call
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
        addLog(`Write: ${fp} (${(args.content || "").length} chars)`);
        result = execWrite(fp, args.content || "");
      } else {
        result = `ERROR: Unknown tool: ${fnName}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: String(result),
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

  // Final status
  if (outputs.length > 0) {
    updateStatus({
      status: "done",
      step: "Termine",
      progress: 100,
      message: `${outputs.length} fichier(s) produit(s)`,
      outputs,
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
