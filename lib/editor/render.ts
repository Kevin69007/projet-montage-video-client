/**
 * Server-side render: applies user edits from an EditorState to produce a new video.
 *
 * Steps:
 * 1. Compute kept segments from cuts + deletedSegments (same algo as store.ts::computeSegments)
 * 2. Use ffmpeg concat FILTER (never demuxer) to produce a cut video from kept segments
 * 3. Filter transcription: drop deleted words, drop deleted silences, apply trimTo
 * 4. Shift transcription timestamps to match the cut video
 * 5. Optionally burn subtitles using burn_subtitles.py + the cleaned transcription + selected style
 * 6. Copy output to jobs/{id}/output/{file}_v{N}.mp4 + {stem}_v{N}_transcription.json
 * 7. Update outputs.json with the new entry
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { EditorState, TranscriptEntry, TranscriptWord, TranscriptSilence } from "./types";

interface Segment {
  id: string;
  start: number;
  end: number;
  deleted: boolean;
}

export interface RenderResult {
  videoFile: string;           // e.g. "reel_1_v2.mp4"
  transcriptionFile: string;   // e.g. "reel_1_v2_transcription.json"
  version: number;             // 2, 3, ...
  subtitlesBurned: boolean;
  duration: number;            // seconds
}

function computeSegments(
  cuts: number[],
  deletedSegments: string[],
  duration: number
): Segment[] {
  if (duration <= 0) return [];
  const points = [0, ...cuts.filter((c) => c > 0 && c < duration), duration].sort(
    (a, b) => a - b
  );
  const dedup = points.filter((p, i) => i === 0 || p !== points[i - 1]);
  const segments: Segment[] = [];
  for (let i = 0; i < dedup.length - 1; i++) {
    const id = `seg_${i}`;
    segments.push({
      id,
      start: dedup[i],
      end: dedup[i + 1],
      deleted: deletedSegments.includes(id),
    });
  }
  return segments;
}

function probeDuration(videoPath: string, ffmpegPath: string): number {
  const ffprobe = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  try {
    const out = execSync(
      `"${ffprobe}" -v error -show_entries format=duration -of default=nw=1:nk=1 "${videoPath}"`,
      { encoding: "utf-8" }
    ).trim();
    return parseFloat(out) || 0;
  } catch {
    // Fallback: try generic ffprobe in PATH
    try {
      const out = execSync(
        `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${videoPath}"`,
        { encoding: "utf-8" }
      ).trim();
      return parseFloat(out) || 0;
    } catch {
      return 0;
    }
  }
}

/**
 * Apply cuts: produce a video keeping only non-deleted segments.
 * Uses concat filter (never demuxer). Returns output path.
 */
function applyCuts(
  inputVideo: string,
  keptSegments: Segment[],
  outputVideo: string,
  ffmpegPath: string
): void {
  if (keptSegments.length === 0) {
    throw new Error("Aucun segment garde — impossible de produire une video.");
  }

  // Single segment = simple trim
  if (keptSegments.length === 1) {
    const seg = keptSegments[0];
    execSync(
      `"${ffmpegPath}" -y -ss ${seg.start} -to ${seg.end} -i "${inputVideo}" -c:v libx264 -crf 18 -c:a aac -ar 48000 -ac 2 "${outputVideo}"`,
      { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 }
    );
    return;
  }

  // Multi-segment concat filter
  const inputs = keptSegments
    .map((s) => `-ss ${s.start} -to ${s.end} -i "${inputVideo}"`)
    .join(" ");
  const filterParts = keptSegments
    .map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`)
    .join(";");
  const concatInputs = keptSegments.map((_, i) => `[v${i}][a${i}]`).join("");
  const filter = `${filterParts};${concatInputs}concat=n=${keptSegments.length}:v=1:a=1[outv][outa]`;

  execSync(
    `"${ffmpegPath}" -y ${inputs} -filter_complex "${filter}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${outputVideo}"`,
    { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 }
  );
}

/**
 * Remap transcription to the new cut video timeline.
 * - Drops deleted words / deleted silences
 * - Includes entries that overlap with kept segments (clipped to segment bounds)
 * - Applies trimTo for silences
 * - Shifts remaining timestamps to start at 0 of the concat result
 */
function remapTranscription(
  transcription: TranscriptEntry[],
  keptSegments: Segment[]
): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  let cursor = 0; // running position in the output timeline

  for (const seg of keptSegments) {
    const segDuration = seg.end - seg.start;

    for (const entry of transcription) {
      if (entry.type === "word" && entry.deleted) continue;
      if (entry.type === "silence" && entry.deleted) continue;

      // Include entries that overlap with this segment (clip to bounds)
      const overlap =
        entry.start < seg.end && entry.end > seg.start;
      if (!overlap) continue;

      const clippedStart = Math.max(entry.start, seg.start);
      const clippedEnd = Math.min(entry.end, seg.end);
      if (clippedEnd <= clippedStart) continue;

      if (entry.type === "silence") {
        const trim = typeof entry.trimTo === "number" ? entry.trimTo : null;
        const naturalDuration = clippedEnd - clippedStart;
        const duration = trim !== null ? Math.min(trim, naturalDuration) : naturalDuration;
        if (duration <= 0) continue;
        out.push({
          id: entry.id,
          type: "silence",
          start: cursor + (clippedStart - seg.start),
          end: cursor + (clippedStart - seg.start) + duration,
          duration,
        } as TranscriptSilence);
      } else {
        out.push({
          id: entry.id,
          type: "word",
          word: entry.word,
          start: cursor + (clippedStart - seg.start),
          end: cursor + (clippedEnd - seg.start),
          lineBreak: entry.lineBreak,
        } as TranscriptWord);
      }
    }
    cursor += segDuration;
  }

  // Sort by start time and renumber IDs
  out.sort((a, b) => a.start - b.start);
  return out.map((e, i) => ({
    ...e,
    id: e.type === "word" ? `w_${i}` : `s_${i}`,
  }));
}

/**
 * Optionally burn subtitles using burn_subtitles.py + edited transcription.
 * Returns path to the subtitled video.
 */
function burnSubtitles(
  cutVideo: string,
  transcriptionPath: string,
  style: EditorState["style"],
  outputVideo: string,
  scriptsDir: string,
  fontsDir: string,
  ffmpegPath: string
): void {
  if (!style.config) {
    throw new Error("Style config manquant pour burn_subtitles.");
  }
  const accent = style.accentColor || style.config.accentColor;
  const fontSize = style.sizeOverride || style.config.size;
  const wpl = style.wpl || style.config.wordsPerLine || 3;
  const lines = style.lines || 2;
  const scriptName = style.name === "cove" ? "burn_subtitles_cove.py" : "burn_subtitles.py";
  const cmd = `FFMPEG_PATH="${ffmpegPath}" FONTS_DIR="${fontsDir}" python3 "${path.join(scriptsDir, scriptName)}" "${cutVideo}" "${transcriptionPath}" "${accent}" "${outputVideo}" ${fontSize} ${wpl} ${lines}`;
  execSync(cmd, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024, shell: "/bin/bash" as string });
}

/**
 * Find next available version number for a file stem.
 * E.g. if reel_1.mp4 and reel_1_v2.mp4 exist → returns 3.
 */
function nextVersion(outputDir: string, stem: string, ext: string): number {
  const files = fs.readdirSync(outputDir);
  const re = new RegExp(`^${stem}(?:_v(\\d+))?${ext.replace(".", "\\.")}$`);
  let max = 1;
  for (const f of files) {
    const m = f.match(re);
    if (m) {
      const v = m[1] ? parseInt(m[1]) : 1;
      if (v > max) max = v;
    }
  }
  return max + 1;
}

export interface RenderOptions {
  jobId: string;
  sourceFile: string;                 // e.g. "reel_1.mp4"
  editorState: EditorState;
  burnSubtitles: boolean;             // if true, produce a video WITH subtitles burned
  projectRoot: string;                // absolute path to the project root
  ffmpegPath: string;
}

export async function renderEditorOutput(opts: RenderOptions): Promise<RenderResult> {
  const { jobId, sourceFile, editorState, burnSubtitles: shouldBurn, projectRoot, ffmpegPath } = opts;

  const jobDir = path.join(projectRoot, "jobs", jobId);
  const outputDir = path.join(jobDir, "output");
  const workDir = path.join(jobDir, "work", `render_${Date.now()}`);
  const scriptsDir = path.join(projectRoot, "pipeline", "scripts");
  const fontsDir = path.join(projectRoot, "pipeline", "fonts");

  fs.mkdirSync(workDir, { recursive: true });

  const sourceVideoPath = path.join(outputDir, sourceFile);
  if (!fs.existsSync(sourceVideoPath)) {
    throw new Error(`Source video not found: ${sourceFile}`);
  }

  const duration = probeDuration(sourceVideoPath, ffmpegPath);
  if (duration <= 0) {
    throw new Error("Impossible de lire la duree de la source.");
  }

  const allSegments = computeSegments(
    editorState.cuts,
    editorState.deletedSegments,
    duration
  );
  const keptSegments = allSegments.filter((s) => !s.deleted);
  if (keptSegments.length === 0) {
    throw new Error("Tous les segments sont supprimes — rien a rendre.");
  }

  // Step 1: apply cuts
  const cutVideo = path.join(workDir, "cut.mp4");
  applyCuts(sourceVideoPath, keptSegments, cutVideo, ffmpegPath);

  // Step 2: remap transcription
  const remapped = remapTranscription(editorState.transcription, keptSegments);
  const cutTranscription = path.join(workDir, "cut_transcription.json");
  fs.writeFileSync(cutTranscription, JSON.stringify(remapped, null, 2));

  // Step 3: pick final video (with or without subtitles)
  let finalVideo = cutVideo;
  if (shouldBurn && editorState.style.config) {
    const subtitledVideo = path.join(workDir, "final.mp4");
    burnSubtitles(
      cutVideo,
      cutTranscription,
      editorState.style,
      subtitledVideo,
      scriptsDir,
      fontsDir,
      ffmpegPath
    );
    finalVideo = subtitledVideo;
  }

  // Step 4: place in output dir with versioned name
  const ext = path.extname(sourceFile);
  const stem = path.basename(sourceFile, ext).replace(/_v\d+$/, "");
  const version = nextVersion(outputDir, stem, ext);
  const outName = `${stem}_v${version}${ext}`;
  const outTranscriptionName = `${stem}_v${version}_transcription.json`;
  const outPath = path.join(outputDir, outName);
  const outTranscriptionPath = path.join(outputDir, outTranscriptionName);

  fs.copyFileSync(finalVideo, outPath);
  fs.copyFileSync(cutTranscription, outTranscriptionPath);

  // Step 5: update outputs.json with new entry
  const manifestPath = path.join(jobDir, "outputs.json");
  let manifest: Array<Record<string, unknown>> = [];
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (!Array.isArray(manifest)) manifest = [];
    } catch {
      manifest = [];
    }
  }

  const sourceEntry = manifest.find((m) => m.file === sourceFile);
  const newEntry = {
    file: outName,
    label: `${sourceEntry?.label || stem} — v${version}${shouldBurn ? "" : " (sans ST)"}`,
    description: (sourceEntry?.description as string) || "",
    transcription: outTranscriptionName,
    subtitlesBurned: shouldBurn,
  };
  manifest.push(newEntry);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Cleanup work dir (keep on disk for debugging — comment out if needed)
  // fs.rmSync(workDir, { recursive: true, force: true });

  return {
    videoFile: outName,
    transcriptionFile: outTranscriptionName,
    version,
    subtitlesBurned: shouldBurn,
    duration: keptSegments.reduce((acc, s) => acc + (s.end - s.start), 0),
  };
}
