/**
 * Centralized LLM prompts for the Kimi worker.
 * All text shown to Kimi (system, user, reminders, coaching, vision) lives here.
 *
 * Each function accepts a config object so prompts stay pure and testable.
 * Worker imports these and passes runtime values (paths, params, etc.).
 */

import fs from "fs";
import path from "path";

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

/**
 * @param {object} cfg
 * @param {string} cfg.ffmpegPath   - Resolved ffmpeg binary path
 * @param {string} cfg.scriptsDir   - Absolute path to pipeline/scripts/
 * @param {string} cfg.fontsDir     - Absolute path to pipeline/fonts/
 * @param {string} cfg.pipelineDir  - Absolute path to pipeline/ (to read styles.json)
 */
export function buildSystemPrompt({ ffmpegPath, scriptsDir, fontsDir, pipelineDir }) {
  let stylesJson = "{}";
  try {
    stylesJson = fs.readFileSync(path.join(pipelineDir, "styles.json"), "utf-8");
  } catch (e) {
    console.error(`Warning: styles.json not readable (${e.message})`);
  }

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
python3 "${scriptsDir}/transcribe.py" --video "<chemin_video>" --output "<chemin_sortie.json>" --language fr
\`\`\`
Produit : JSON avec \`{type:"word", word, start, end}\` et \`{type:"silence", start, end, duration}\`.
Duree typique : 1-3 min par minute de video.

## 2. Sous-titres Hormozi / variantes
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${fontsDir}" python3 "${scriptsDir}/burn_subtitles.py" \\
  "<video.mp4>" "<transcription.json>" "<accent_hex>" "<output.mp4>" <font_size> <wpl> <lines>
\`\`\`
Exemple concret :
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${fontsDir}" python3 "${scriptsDir}/burn_subtitles.py" \\
  "/app/jobs/abc/work/cut.mp4" "/app/jobs/abc/work/cut_transcription.json" "#FFD700" "/app/jobs/abc/work/final.mp4" 80 5 2
\`\`\`

Pour le style Cove (dual-font) :
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${fontsDir}" python3 "${scriptsDir}/burn_subtitles_cove.py" \\
  "<video>" "<transcription.json>" "<output>" "<accent_hex>" <font_size> <wpl> <lines>
\`\`\`

## 3. Text frame (ecran de fin 4s, 1080x1920)
\`\`\`bash
FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${fontsDir}" python3 "${scriptsDir}/generate_text_frame.py" \\
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

// ============================================================================
// USER PROMPTS (video + miniature)
// ============================================================================

/**
 * Dispatcher: routes to video or miniature builder based on params.mode.
 *
 * @param {object} params - Job parameters from params.json
 * @param {object} ctx
 * @param {string[]} ctx.videoPaths
 * @param {string} ctx.workDir
 * @param {string} ctx.outputDir
 * @param {string} ctx.outputsJsonPath
 * @param {string} ctx.pipelineDir
 * @param {string} ctx.inputDir
 * @param {string|null} ctx.referenceFile - For miniature mode
 */
export function buildUserPrompt(params, ctx) {
  if (params.mode === "miniature") {
    return buildMiniaturePrompt(params, ctx);
  }
  return buildVideoPrompt(params, ctx);
}

function buildVideoPrompt(params, { videoPaths, workDir, outputDir, outputsJsonPath, pipelineDir }) {
  const videoList = videoPaths.map((p, i) => `  - Video ${i + 1}: ${p}`).join("\n");
  const durationTarget = params.videoType === "teaser" ? params.duration : null;
  const styleName = params.style || "hormozi";

  let styleConfig = {};
  try {
    const styles = JSON.parse(fs.readFileSync(path.join(pipelineDir, "styles.json"), "utf-8"));
    styleConfig = styles[styleName] || {};
  } catch (_) {}
  const accent = params.accentColor || styleConfig.accentColor || "#FFD700";
  const fontSize = styleConfig.size || 80;
  const wpl = styleConfig.wordsPerLine || 5;

  return `# TACHE : MONTAGE VIDEO

## Parametres
- Mode : ${params.videoType || "teaser"}
${durationTarget ? `- Duree cible : ${durationTarget}s MAXIMUM (strict +/- 3s)` : ""}
- Format : ${params.format || "9:16"}${params.format === "9:16" ? " (vertical Reels — utiliser crop 9:16)" : ""}
- Style sous-titres : ${styleName} (accent: ${accent}, taille: ${fontSize}px, mots/ligne: ${wpl})
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

function buildMiniaturePrompt(params, { videoPaths, workDir, outputDir, outputsJsonPath, referenceFile, inputDir }) {
  // Separate video files from reference image
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
${referenceFile
    ? `- Image de reference : ${referenceFile}\n  (tu la vois directement dans ce message — analyse-la visuellement)`
    : `- Image de reference : AUCUNE (aucune image reference fournie — genere les miniatures en t'inspirant du prompt utilisateur uniquement)`}
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

// ============================================================================
// FALLBACK PROMPT REPLACEMENT (when reference image cannot be sent inline)
// ============================================================================

/**
 * Replaces the "(tu la vois directement...)" line with a Read instruction
 * when the inline image fails to load.
 */
export function rewritePromptForReadFallback(promptText) {
  return promptText.replace(
    /\(tu la vois directement dans ce message — analyse-la visuellement\)/g,
    "(utilise Read sur ce chemin pour obtenir une description detaillee du style)"
  );
}

// ============================================================================
// VISION API PROMPT (used by describeImage)
// ============================================================================

export const IMAGE_DESCRIPTION_PROMPT = `Decris cette image avec un MAXIMUM de details, en francais :

1. COULEURS : liste les 3-5 couleurs dominantes avec codes hex approximatifs (background, texte, accents).
2. TYPOGRAPHIE : police (sans-serif / serif / display), taille relative, couleur, position, outline/shadow/glow.
3. COMPOSITION : ou est le sujet principal ? ou est le texte ? left/right/center/top/bottom.
4. ELEMENTS DECORATIFS : bordures, flecheurs, emojis, badges, formes geometriques, cadres incline.
5. MOOD : bold / minimaliste / playful / corporate / gaming / food.
6. SUJET : quelle personne/objet est mis en avant.

Sois TRES precis pour que quelqu'un puisse reproduire le style.`;

// ============================================================================
// CONTEXT REMINDER (injected every N iterations)
// ============================================================================

/**
 * Reminds Kimi of original task parameters to combat context drift.
 *
 * @param {object} cfg
 * @param {number} cfg.iteration
 * @param {number} cfg.maxIterations
 * @param {string} cfg.taskSummary - Short string with mode/format/style/etc.
 */
export function buildContextReminder({ iteration, maxIterations, taskSummary }) {
  return `[RAPPEL — iteration ${iteration}/${maxIterations}] Verifie que tu respectes toujours : ${taskSummary}. N'oublie pas d'ecrire outputs.json a la fin.`;
}

// ============================================================================
// OUTPUTS.JSON REMINDER (injected when Kimi forgets to write the manifest)
// ============================================================================

/**
 * @param {object} cfg
 * @param {string} cfg.outputDir
 * @param {string} cfg.outputsJsonPath
 * @param {string[]} cfg.existingFiles - Files already present in outputDir/
 */
export function buildOutputsReminder({ outputDir, outputsJsonPath, existingFiles }) {
  const filesBlock = existingFiles.length > 0
    ? `Fichiers deja presents dans ${outputDir}/ :\n${existingFiles.map(f => `  - ${f}`).join("\n")}\n`
    : `Aucun fichier dans ${outputDir}/ pour l'instant — tu dois d'abord copier tes livrables la-bas avec Bash 'cp'.\n`;

  return `[VERIFICATION MANQUANTE] Tu n'as pas ecrit outputs.json (ou il est vide). C'est OBLIGATOIRE pour terminer.

${filesBlock}

Utilise l'outil Write MAINTENANT :
- file_path : "${outputsJsonPath}"
- content : un JSON array comme : [{"file":"nom.mp4","label":"Titre court","description":"Description Instagram longue avec emojis et hashtags"}]

Apres le Write, reponds juste "Termine" sans autre appel d'outil.`;
}

// ============================================================================
// TOOL ERROR COACHING (appended to error results to guide Kimi)
// ============================================================================

/**
 * Inspects an error result string and appends a contextual hint.
 * Returns the original result unchanged if it doesn't look like an error.
 */
export function coachToolError(toolName, result) {
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
    if (r.includes("concat")) {
      hint += "\n[ASTUCE] Utilise le concat FILTER (-filter_complex \"...concat=n=...\"), JAMAIS le concat demuxer (-f concat).";
    }
  } else if (toolName === "Write" && r.includes("ENOENT")) {
    hint = "\n\n[ASTUCE] Le repertoire parent n'existe pas. Cree-le d'abord avec Bash: `mkdir -p <dir>`.";
  }
  return r + hint;
}

// ============================================================================
// TASK SUMMARY (used by reminders to remind Kimi of original parameters)
// ============================================================================

/**
 * Builds a short one-line summary of the job parameters.
 * Used by buildContextReminder to combat context drift.
 */
export function buildTaskSummary(params, referenceFile) {
  if (params.mode === "miniature") {
    return `mode=miniature, ${params.thumbnailCount || 2} miniatures, format=${params.thumbnailFormat || "16:9"}, reference=${referenceFile ? path.basename(referenceFile) : "none"}`;
  }
  return `mode=video, type=${params.videoType || "teaser"}, duree max=${params.duration || 30}s, format=${params.format || "9:16"}, style=${params.style || "hormozi"}, langue=${params.language || "fr"}`;
}
