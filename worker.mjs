#!/usr/bin/env node

/**
 * Worker process — spawns Claude CLI to run video editing pipeline.
 * Uses the user's Claude subscription (no API key needed).
 *
 * Usage: node worker.mjs <jobId>
 * Reads job params from jobs/<jobId>/params.json
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
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

// --- Find Claude CLI ---

function findClaude() {
  const candidates = [
    "/usr/local/lib/node_modules/.bin/claude",  // npm global (Docker)
    "/usr/local/bin/claude",                     // npm global symlink
    path.join(process.env.HOME || "", ".local", "bin", "claude"),  // Mac/Linux local
    "/opt/homebrew/bin/claude",                  // Homebrew Mac
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Fallback: hope it's in PATH
  return "claude";
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

## OUTILS DISPONIBLES
Tu utilises UNIQUEMENT l'outil Bash pour executer des commandes. Voici les scripts et commandes disponibles :

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
- **Fin PROPRE** : TOUJOURS couper sur une phrase COMPLETE. Jamais au milieu d'un mot. La derniere phrase doit etre une punchline ou un cliffhanger. Marge 0.7-1.0s apres dernier mot.

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
1. Copier le fichier final dans le repertoire output :
   \`cp "<fichier_final>" "<output_dir>/"\`
2. Ecrire le manifeste outputs.json (ECRASER le fichier a chaque fois avec la liste complete) :
   Le fichier doit contenir un tableau JSON :
   \`\`\`json
   [
     {"file": "nom_fichier.mp4", "label": "Teaser 30s", "description": "Description Instagram..."},
     {"file": "miniature.jpg", "label": "Miniature", "description": ""}
   ]
   \`\`\`
   Ecris ce fichier avec : \`cat > "<outputs_json_path>" << 'MANIFEST_EOF'\n[...contenu...]\nMANIFEST_EOF\`

Tu peux produire PLUSIEURS outputs (2+ videos, miniatures, etc.). Chaque fichier doit avoir son entree dans outputs.json.
TOUJOURS produire au moins un fichier. Ne JAMAIS terminer sans sauvegarder.

## ERREURS A EVITER
- Ne JAMAIS utiliser les timestamps bruts sans transcrire d'abord
- Marge de fin trop courte (0.2-0.3s) = mots coupes. Minimum 0.5s
- Segment avant silence : utiliser 0.7-1.0s de marge (pas 0.5s)
- Ne JAMAIS utiliser -f concat (demuxer). Toujours le concat FILTER.

## MODE MINIATURE (THUMBNAIL)

Quand le mode est "miniature", tu produis des IMAGES de miniature (thumbnails) pour YouTube/Instagram, PAS des videos.

### Pipeline miniature
1. **Analyser la video** — Extraire 8-12 frames candidats a des moments cles :
   \`ffmpeg -y -ss <timestamp> -i "<video>" -frames:v 1 "<output.jpg>"\`
   Choisis des moments expressifs : reactions, gestes, emotions, moments forts.

2. **Analyser l'image de reference** — Lis l'image de reference avec l'outil Read pour comprendre :
   - La composition (cadrage, placement du texte, layout)
   - Le fond (couleur unie, degrade, motif, photo)
   - Le style visuel (couleurs dominantes, contraste, effets)
   - La typographie (taille, style, position, couleur, ombre, contour)
   - Les elements decoratifs (bordures, emojis, icones, formes, cadres)
   - Le placement de la photo/video (plein ecran, encadre, incline, avec bordure)

3. **Selectionner les meilleures frames** — Choisir les frames les plus expressives.

4. **Ecrire un script Python custom** — NE PAS utiliser generate_thumbnail.py si la reference est complexe.
   Ecris plutot un script Python/Pillow CUSTOM dans le repertoire de travail qui reproduit fidelement le style :
   \`\`\`python
   from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
   # Analyser la reference et reproduire :
   # - Fond colore (ex: rose #FF69B4)
   # - Photo du speaker dans un cadre incline avec bordure blanche
   # - Texte gros avec ombre et couleur specifique
   # - Elements decoratifs (barres, formes, emojis)
   # - Resolution 1280x720
   \`\`\`

   **IMPORTANT** : Le script doit reproduire le STYLE de la reference, pas juste mettre du texte sur une frame.
   Exemples de ce que tu peux faire avec Pillow :
   - Fond uni/degrade : \`Image.new('RGB', (1280, 720), (255, 105, 180))\`
   - Rotation d'image : \`frame.rotate(angle, expand=True)\`
   - Bordure blanche : dessiner un rectangle blanc plus grand derriere la frame
   - Ombre portee : coller une version noire decalee sous la frame
   - Texte avec contour : dessiner le texte en noir decale, puis en couleur par-dessus
   - Formes decoratives : \`draw.rectangle()\`, \`draw.ellipse()\`, \`draw.line()\`
   - Redimensionner : \`img.resize((w, h), Image.LANCZOS)\`
   - Coller une image sur une autre : \`bg.paste(frame, (x, y))\`

   Pour le texte, utilise la police : \`${FONTS_DIR}/BigShoulders-Black.ttf\`

5. **Sauvegarder** — Copier dans output/ et ecrire outputs.json

### Regles miniature
- Miniature 1 : Reproduire le style de la reference aussi fidelement que possible (meme fond, meme layout, meme style de texte)
- Miniature 2+ : Meme style general mais composition differente (autre frame, texte different, variante creative)
- Resolution : 1280x720 (YouTube standard)
- Format : JPEG haute qualite (\`img.save(path, 'JPEG', quality=95)\`)
- Le texte est OPTIONNEL — ne l'ajouter que si l'utilisateur l'a fourni
- Choisir des frames DIFFERENTES pour chaque miniature
- TOUJOURS ecrire et executer un script Python custom — ne jamais juste copier une frame brute`;
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

  // Separate video files from reference image
  const videoFiles = [];
  let referenceFile = "";
  for (const f of params.fileNames) {
    if (params.referenceFileName && f.includes(params.referenceFileName.replace(/[^a-zA-Z0-9._-]/g, "_"))) {
      referenceFile = path.join(inputDir, f);
    } else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(f)) {
      // If no explicit reference match, treat image files as reference
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
Nombre de miniatures a produire : ${params.thumbnailCount || 2}${params.thumbnailText ? `\nTexte a ajouter : "${params.thumbnailText}"` : ""}${params.accentColor ? `\nCouleur accent : ${params.accentColor}` : ""}

## INSTRUCTIONS
1. Extrais 8-12 frames de la video a des moments expressifs/interessants (utilise ffmpeg -ss)
2. Lis et analyse l'image de reference pour comprendre son style visuel
3. Pour la miniature 1 : utilise generate_thumbnail.py avec --style match pour reproduire fidelement le style de la reference
4. Pour les miniatures suivantes : utilise --style creative pour des variations plus audacieuses
5. Utilise des frames DIFFERENTES pour chaque miniature
6. SAUVEGARDE : Copie chaque miniature dans ${outputDir}/ et ecris le manifeste ${outputsJsonPath}

## Prompt de l'utilisateur :
${params.prompt}`;
}

// --- Progress detection from stream-json ---

function detectProgress(line) {
  const text = typeof line === "string" ? line : JSON.stringify(line);

  // Miniature mode progress
  if (text.includes("generate_thumbnail.py")) return { step: "Composition", progress: 70, message: "Composition de la miniature..." };
  if (text.includes("frames:v 1")) return { step: "Extraction frames", progress: 30, message: "Extraction des frames..." };

  // Video mode progress
  if (text.includes("transcribe.py")) return { step: "Transcription", progress: 20, message: "Transcription Whisper en cours..." };
  if (text.includes("ffprobe")) return { step: "Analyse", progress: 10, message: "Analyse du fichier video..." };
  if (text.includes("ffmpeg") && (text.includes("-ss") || text.includes("concat"))) {
    if (text.includes("burn_subtitles") || text.includes(".ass")) return null;
    if (text.includes("text_frame") || text.includes("generate_text_frame")) return null;
    return { step: "Decoupe", progress: 40, message: "Decoupe et assemblage des segments..." };
  }
  if (text.includes("burn_subtitles")) return { step: "Sous-titres", progress: 65, message: "Application des sous-titres..." };
  if (text.includes("generate_text_frame")) return { step: "Text frame", progress: 80, message: "Generation de l'ecran de fin..." };
  if (text.includes("outputs.json") || text.includes("MANIFEST_EOF")) return { step: "Sauvegarde", progress: 95, message: "Sauvegarde des fichiers..." };
  return null;
}

// --- Main ---

async function main() {
  console.log(`[WORKER ${jobId}] Starting...`);

  const paramsPath = path.join(jobDir, "params.json");
  if (!fs.existsSync(paramsPath)) {
    writeError(`params.json not found at ${paramsPath}`);
    process.exit(1);
  }

  const params = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
  console.log(`[WORKER ${jobId}] Params: prompt="${params.prompt.slice(0, 50)}...", style=${params.style}, files=${params.fileNames.join(", ")}`);

  // Set up directories
  const inputDir = path.join(jobDir, "input");
  const workDir = path.join(jobDir, "work");
  const outputDir = path.join(jobDir, "output");
  const outputsJsonPath = path.join(jobDir, "outputs.json");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const videoPaths = params.fileNames.map(f => path.join(inputDir, f));

  // Find tools
  const claudePath = findClaude();
  const ffmpegPath = findFfmpegFull();
  console.log(`[WORKER ${jobId}] Claude CLI: ${claudePath}`);
  console.log(`[WORKER ${jobId}] FFmpeg: ${ffmpegPath}`);

  // Build prompts
  const systemPrompt = buildSystemPrompt(ffmpegPath);
  const userPrompt = buildUserPrompt(params, videoPaths, workDir, outputDir, outputsJsonPath);

  // Write prompts to temp files (avoid shell escaping issues)
  const systemPromptPath = path.join(jobDir, "system_prompt.txt");
  const userPromptPath = path.join(jobDir, "user_prompt.txt");
  fs.writeFileSync(systemPromptPath, systemPrompt);
  fs.writeFileSync(userPromptPath, userPrompt);

  updateStatus({ status: "processing", step: "Initialisation", progress: 5, message: "Demarrage du pipeline Claude..." });
  if (params.mode === "miniature") {
    const videoCount = params.fileNames.filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f)).length;
    const imageCount = params.fileNames.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).length;
    addLog(`Mode miniature — ${videoCount} video(s), ${imageCount} image(s) reference`);
  } else {
    addLog(`Demarrage avec ${params.fileNames.length} video(s)`);
  }

  // Spawn Claude CLI
  const args = [
    "-p",
    userPrompt,
    "--output-format", "stream-json",
    "--verbose",
    "--system-prompt", systemPrompt,
    "--tools", "Bash,Read,Write",
    "--permission-mode", "bypassPermissions",
    "--add-dir", jobDir,
    "--add-dir", PIPELINE_DIR,
    "--model", "sonnet",
    "--no-session-persistence",
  ];

  console.log(`[WORKER ${jobId}] Spawning: ${claudePath} -p ...`);

  const child = spawn(claudePath, args, {
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${path.join(process.env.HOME || "", ".local", "bin")}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      FFMPEG_PATH: ffmpegPath,
      FONTS_DIR: FONTS_DIR,
    },
  });

  let stderrBuffer = "";
  let lastProgress = 5;

  // Parse stream-json from stdout
  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || ""; // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);

        // Log assistant messages
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_use" && block.name === "Bash") {
              const cmd = block.input?.command || "";
              const shortCmd = cmd.length > 150 ? cmd.slice(0, 150) + "..." : cmd;
              addLog(`Bash: ${shortCmd}`);

              // Detect progress from command
              const progress = detectProgress(cmd);
              if (progress && progress.progress > lastProgress) {
                lastProgress = progress.progress;
                updateStatus(progress);
              }
            } else if (block.type === "tool_use") {
              addLog(`${block.name}: ${JSON.stringify(block.input || {}).slice(0, 150)}`);
            } else if (block.type === "text" && block.text) {
              const text = block.text.trim();
              if (text) addLog(`Claude: ${text.slice(0, 300)}`);
            }
          }
        }

        // Check for errors
        if (event.type === "assistant" && event.error) {
          addLog(`Erreur Claude: ${event.error}`);
          if (event.error === "authentication_failed") {
            writeError("Claude CLI non connecte. Lance 'claude login' dans le terminal.");
            process.exit(1);
          }
        }

        // Check for result (final event)
        if (event.type === "result") {
          if (event.is_error) {
            addLog(`Pipeline termine avec erreur: ${event.result?.slice(0, 300) || "unknown"}`);
          } else {
            addLog(`Pipeline Claude termine (${event.num_turns} tours, ${event.duration_ms}ms)`);
          }
        }
      } catch (_) {
        // Non-JSON line, skip
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  // Wait for process to exit
  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      addLog(`Erreur spawn: ${err.message}`);
      resolve(1);
    });
  });

  console.log(`[WORKER ${jobId}] Claude CLI exited with code ${exitCode}`);

  if (stderrBuffer.trim()) {
    const lastStderr = stderrBuffer.trim().split("\n").slice(-5).join("\n");
    console.error(`[WORKER ${jobId}] stderr: ${lastStderr}`);
  }

  // Collect outputs
  let outputs = [];

  // Try reading outputs.json written by Claude
  if (fs.existsSync(outputsJsonPath)) {
    try {
      outputs = JSON.parse(fs.readFileSync(outputsJsonPath, "utf-8"));
      if (!Array.isArray(outputs)) outputs = [outputs];
      addLog(`Manifeste trouve: ${outputs.length} fichier(s)`);
    } catch (e) {
      addLog(`Erreur lecture outputs.json: ${e.message}`);
    }
  }

  // Fallback: scan output directory for video files
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
      // Write manifest for consistency
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
    const errorMsg = exitCode !== 0
      ? `Claude CLI a quitte avec le code ${exitCode}. Verifiez que Claude est connecte (claude login).`
      : "Aucun fichier produit. Le pipeline n'a pas genere de sortie.";
    updateStatus({
      status: "error",
      step: "Erreur",
      progress: 100,
      message: errorMsg,
      outputs: [],
    });
    addLog(`Echec: ${errorMsg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  writeError(err.message || "Unknown fatal error");
  console.error(`[WORKER ${jobId}] Fatal:`, err);
  process.exit(1);
});
