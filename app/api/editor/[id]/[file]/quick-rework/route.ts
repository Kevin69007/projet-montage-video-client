import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  buildEditorReworkSystem,
  buildEditorReworkUserMessage,
} from "@/prompts.mjs";
import { renderEditorOutput } from "@/lib/editor/render";
import type {
  AppliedSubtitleStyle,
  EditorState,
  SubtitleStyle,
  TranscriptEntry,
} from "@/lib/editor/types";

export const runtime = "nodejs";
export const maxDuration = 600;

const KIMI_API_URL = "https://api.moonshot.ai/v1/chat/completions";
const KIMI_MODEL = process.env.KIMI_MODEL || "kimi-k2.6";
// Bumped from 6000 → 16000 because full-mode reworks on long videos can
// produce big patches (lots of segment IDs / kept ranges). At 6K Kimi was
// truncating mid-JSON and we returned "Kimi reponse invalide".
const MAX_TOKENS = 16000;
const DEFAULT_STYLE_NAME = "hormozi";

interface KimiChanges {
  deletedWordIds?: string[];
  restoredWordIds?: string[];
  deletedSilenceIds?: string[];
  trimSilences?: Array<{ id: string; trimTo: number | null }>;
  lineBreakToggles?: string[];
  addCuts?: number[];
  removeCuts?: number[];
  toggleSegmentDeletes?: string[];
  /**
   * Compact extension/cut format: time windows (in source seconds) to KEEP.
   * Server expands these into cuts + segment-deletions. Preferred over
   * deletedWordIds for big edits because the JSON stays small.
   */
  keepRanges?: Array<{ start: number; end: number }>;
  style?: {
    name?: string;
    accentColor?: string;
    sizeOverride?: number | null;
    posY?: number;
    wpl?: number;
    lines?: number;
    aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | "4:3" | "original";
  };
}

interface KimiOutput {
  reply: string;
  changes?: KimiChanges;
}

type AspectRatioValue = NonNullable<NonNullable<KimiChanges["style"]>["aspectRatio"]>;
const VALID_ASPECT_RATIOS: ReadonlySet<AspectRatioValue> = new Set([
  "9:16", "16:9", "1:1", "4:5", "4:3", "original",
]);
function sanitizeAspectRatio(v: unknown): AspectRatioValue | undefined {
  return typeof v === "string" && (VALID_ASPECT_RATIOS as ReadonlySet<string>).has(v)
    ? (v as AspectRatioValue)
    : undefined;
}

function findFfmpeg(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "ffmpeg";
}

function extractJson(text: string): KimiOutput | null {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

/**
 * Expand `keepRanges` (time windows to keep) into the editor primitives:
 * - sets `cuts` at each range boundary, sorted + deduplicated
 * - sets `deletedSegments` to the segment ids that fall OUTSIDE every kept range
 *
 * Operates on whatever sourceDuration the caller passes (full timeline when
 * in fullMode). Overlapping ranges are merged. Ranges outside [0, sourceDuration]
 * are clamped.
 */
function expandKeepRanges(
  ranges: Array<{ start: number; end: number }>,
  sourceDuration: number
): { cuts: number[]; deletedSegments: string[] } {
  const cleaned = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(sourceDuration, Number(r.start))),
      end: Math.max(0, Math.min(sourceDuration, Number(r.end))),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of cleaned) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.001) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  if (merged.length === 0) return { cuts: [], deletedSegments: [] };

  // Cuts at every boundary (excluding 0 and sourceDuration which computeSegments adds)
  const cutSet = new Set<number>();
  for (const r of merged) {
    if (r.start > 0 && r.start < sourceDuration) cutSet.add(r.start);
    if (r.end > 0 && r.end < sourceDuration) cutSet.add(r.end);
  }
  const cuts = Array.from(cutSet).sort((a, b) => a - b);

  // Compute segment ids: same algorithm as render.ts::computeSegments and
  // store.ts::computeSegments. seg_i where i is the index in the sorted
  // cut points, INCLUDING 0 and sourceDuration. Mark a segment deleted iff
  // its midpoint is NOT inside any kept range.
  const points = [0, ...cuts, sourceDuration];
  const deletedSegments: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const mid = (points[i] + points[i + 1]) / 2;
    const inside = merged.some((r) => mid >= r.start && mid <= r.end);
    if (!inside) deletedSegments.push(`seg_${i}`);
  }
  return { cuts, deletedSegments };
}

function applyChanges(
  state: EditorState,
  changes: KimiChanges,
  styles: Record<string, SubtitleStyle> = {},
  sourceDuration?: number
): EditorState {
  const next: EditorState = {
    ...state,
    transcription: state.transcription.map((e) => ({ ...e })),
    cuts: [...state.cuts],
    deletedSegments: [...state.deletedSegments],
    markers: [...state.markers],
    style: { ...state.style },
    updatedAt: new Date().toISOString(),
  };

  const deletedSet = new Set(changes.deletedWordIds || []);
  const restoredSet = new Set(changes.restoredWordIds || []);
  const lineBreakSet = new Set(changes.lineBreakToggles || []);
  const deletedSilenceSet = new Set(changes.deletedSilenceIds || []);

  next.transcription = next.transcription.map((e) => {
    if (e.type === "word") {
      if (deletedSet.has(e.id)) return { ...e, deleted: true };
      if (restoredSet.has(e.id)) return { ...e, deleted: false };
      if (lineBreakSet.has(e.id)) return { ...e, lineBreak: !e.lineBreak };
    } else if (e.type === "silence") {
      if (deletedSilenceSet.has(e.id)) return { ...e, deleted: true };
      const trim = changes.trimSilences?.find((t) => t.id === e.id);
      if (trim) return { ...e, trimTo: trim.trimTo };
    }
    return e;
  });

  if (changes.addCuts) {
    for (const t of changes.addCuts) {
      if (!next.cuts.includes(t)) next.cuts.push(t);
    }
    next.cuts.sort((a, b) => a - b);
  }
  if (changes.removeCuts) {
    next.cuts = next.cuts.filter((c) => !changes.removeCuts!.includes(c));
  }

  if (changes.toggleSegmentDeletes) {
    const set = new Set(next.deletedSegments);
    for (const id of changes.toggleSegmentDeletes) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    next.deletedSegments = Array.from(set);
  }

  // Compact extension format: keepRanges takes precedence over manual cuts
  // because it represents Kimi's complete intent (everything outside is cut).
  if (
    changes.keepRanges &&
    Array.isArray(changes.keepRanges) &&
    changes.keepRanges.length > 0 &&
    typeof sourceDuration === "number" &&
    sourceDuration > 0
  ) {
    const expanded = expandKeepRanges(changes.keepRanges, sourceDuration);
    next.cuts = expanded.cuts;
    next.deletedSegments = expanded.deletedSegments;
  }

  if (changes.style) {
    next.style = {
      ...next.style,
      ...(changes.style.accentColor !== undefined ? { accentColor: changes.style.accentColor } : {}),
      ...(changes.style.sizeOverride !== undefined ? { sizeOverride: changes.style.sizeOverride } : {}),
      ...(changes.style.posY !== undefined ? { posY: changes.style.posY } : {}),
      ...(changes.style.wpl !== undefined ? { wpl: changes.style.wpl } : {}),
      ...(changes.style.lines !== undefined ? { lines: changes.style.lines } : {}),
      ...(sanitizeAspectRatio(changes.style.aspectRatio) !== undefined
        ? { aspectRatio: sanitizeAspectRatio(changes.style.aspectRatio) }
        : {}),
    };
    // Only accept name change when it maps to a real style — otherwise we'd
    // end up with name/config mismatch (burner script picked by name, config
    // still the old one).
    if (
      changes.style.name &&
      changes.style.name !== next.style.name &&
      styles[changes.style.name]
    ) {
      next.style = {
        ...next.style,
        name: changes.style.name,
        config: styles[changes.style.name],
      };
    }
  }

  return next;
}

/**
 * Resolve the raw source file for a given output entry.
 * If the file is itself a derived version (`reel_1_v2.mp4`), look up its
 * `sourceFile` field in outputs.json. Otherwise the file is the raw source.
 */
function resolveRawSource(
  manifestPath: string,
  requestedFile: string
): { rawFile: string; entry: Record<string, unknown> | null } {
  if (!fs.existsSync(manifestPath)) {
    return { rawFile: requestedFile, entry: null };
  }
  try {
    const cur = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (Array.isArray(cur)) {
      const found = cur.find((m: { file?: unknown }) => m?.file === requestedFile);
      if (found) {
        const raw = typeof found.sourceFile === "string" && found.sourceFile.length > 0
          ? found.sourceFile
          : requestedFile;
        return { rawFile: raw, entry: found };
      }
    }
  } catch {}
  return { rawFile: requestedFile, entry: null };
}

function defaultStyle(styles: Record<string, SubtitleStyle>): AppliedSubtitleStyle {
  const styleKey = styles[DEFAULT_STYLE_NAME]
    ? DEFAULT_STYLE_NAME
    : Object.keys(styles)[0] || null;
  const cfg = styleKey ? styles[styleKey] : null;
  return {
    name: styleKey,
    config: cfg || null,
    accentColor: cfg?.accentColor || null,
    posY: 75,
    sizeOverride: null,
    wpl: cfg?.wordsPerLine || 3,
    lines: 2,
  };
}

function loadStyles(cwd: string): Record<string, SubtitleStyle> {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "styles.json"), "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Load saved EditorState if present, else build a fresh one from the raw
 * transcription that lives next to the source video.
 */
function loadOrBuildState(
  jobDir: string,
  rawFile: string,
  styles: Record<string, SubtitleStyle>
): EditorState {
  const editsPath = path.join(jobDir, "edits", `${rawFile}.json`);
  if (fs.existsSync(editsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(editsPath, "utf-8"));
      if (parsed && Array.isArray(parsed.transcription)) {
        return parsed as EditorState;
      }
    } catch {}
  }

  // Build fresh from raw transcription
  const outputDir = path.join(jobDir, "output");
  const stem = path.basename(rawFile, path.extname(rawFile));
  const transcriptionPath = path.join(outputDir, `${stem}_transcription.json`);
  let transcription: TranscriptEntry[] = [];
  if (fs.existsSync(transcriptionPath)) {
    try {
      transcription = JSON.parse(fs.readFileSync(transcriptionPath, "utf-8"));
    } catch {}
  }

  return {
    transcription,
    cuts: [],
    deletedSegments: [],
    markers: [],
    style: defaultStyle(styles),
    updatedAt: new Date().toISOString(),
  };
}

function probeDurationSec(videoPath: string, ffmpegPath: string): number {
  const ffprobe = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  for (const candidate of [ffprobe, "ffprobe"]) {
    try {
      const out = execSync(
        `"${candidate}" -v error -show_entries format=duration -of default=nw=1:nk=1 "${videoPath}"`,
        { encoding: "utf-8" }
      ).trim();
      const v = parseFloat(out);
      if (v > 0) return v;
    } catch {}
  }
  return 0;
}

/**
 * Resolve the original input video for a job by reading params.json.
 * Returns the absolute path to the first video file in `fileNames`, or null.
 */
function resolveOriginalInput(jobDir: string): string | null {
  const paramsPath = path.join(jobDir, "params.json");
  if (!fs.existsSync(paramsPath)) return null;
  try {
    const params = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
    const names: unknown[] = Array.isArray(params?.fileNames) ? params.fileNames : [];
    for (const n of names) {
      if (typeof n === "string" && /\.(mp4|mov|avi|mkv|webm)$/i.test(n)) {
        const p = path.join(jobDir, "input", n);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {}
  return null;
}

/**
 * Get (or build + cache) the original transcription for a raw output stem.
 * Cache lives at `output/{stem}_original_transcription.json`.
 *
 * Transcription is slow (~1-3 min per minute of audio). The first call pays
 * the cost; subsequent extension reworks reuse the cache.
 */
function getOrBuildOriginalTranscription(
  outputDir: string,
  stem: string,
  inputVideoPath: string,
  scriptsDir: string,
  language: string
): TranscriptEntry[] {
  const cachePath = path.join(outputDir, `${stem}_original_transcription.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  const cmd = `python3 "${path.join(scriptsDir, "transcribe.py")}" --video "${inputVideoPath}" --output "${cachePath}" --language ${language}`;
  execSync(cmd, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  if (!fs.existsSync(cachePath)) {
    throw new Error("Transcription de l'original a echoue.");
  }
  return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
}

/**
 * POST /api/editor/[id]/[file]/quick-rework
 * Body: { userPrompt: string }
 *
 * One-shot: ask Kimi for a JSON patch from the prompt, apply it to the
 * current EditorState, persist, render with subtitles burned, return the
 * new version info.
 *
 * EXTENSION MODE: when the prompt asks for a duration > current source
 * duration, swap the EditorState to the FULL original transcription and
 * point the renderer at the original input video, so Kimi can pick a
 * longer cut from the unused content.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  try {
    const { id, file } = await params;
    const decodedFile = decodeURIComponent(file);

    if (!process.env.KIMI_API_KEY) {
      return NextResponse.json({ error: "KIMI_API_KEY non configuree" }, { status: 500 });
    }

    const body = await req.json();
    const userPrompt = typeof body?.userPrompt === "string" ? body.userPrompt.trim() : "";
    if (!userPrompt) {
      return NextResponse.json({ error: "userPrompt requis" }, { status: 400 });
    }

    const cwd = /*turbopackIgnore: true*/ process.cwd();
    const jobDir = path.join(cwd, "jobs", id);
    if (!fs.existsSync(jobDir)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const manifestPath = path.join(jobDir, "outputs.json");
    const { rawFile } = resolveRawSource(manifestPath, decodedFile);

    const rawSourcePath = path.join(jobDir, "output", rawFile);
    if (!fs.existsSync(rawSourcePath)) {
      return NextResponse.json(
        { error: `Source raw introuvable: ${rawFile}` },
        { status: 404 }
      );
    }

    const styles = loadStyles(cwd);
    const ffmpegPath = findFfmpeg();

    // ALWAYS use the full original transcription as Kimi's context, so it
    // can intelligently shorten OR extend regardless of the user's wording.
    // The cut output is no longer used as a source; we always render against
    // the original input. Falls back to cut-only mode if the original input
    // is missing (very old jobs without params.json).
    const currentDuration = probeDurationSec(rawSourcePath, ffmpegPath);
    const originalInputPath = resolveOriginalInput(jobDir);
    const originalDuration = originalInputPath ? probeDurationSec(originalInputPath, ffmpegPath) : 0;
    const fullMode = originalInputPath !== null && originalDuration > 0;

    let state: EditorState;
    let durationContext = "";
    if (fullMode && originalInputPath) {
      const scriptsDir = path.join(cwd, "pipeline", "scripts");
      const paramsPath = path.join(jobDir, "params.json");
      let language = "fr";
      try {
        const p = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
        if (typeof p?.language === "string") language = p.language;
      } catch {}
      const stem = path.basename(rawFile, path.extname(rawFile));
      const fullTranscription = getOrBuildOriginalTranscription(
        path.join(jobDir, "output"),
        stem,
        originalInputPath,
        scriptsDir,
        language
      );
      // Fresh state on the full timeline every rework. Prior cuts/deletions
      // belonged to a different timeline (the cut output) and can't be
      // mapped back; each rework starts from the full content and Kimi
      // produces a new selection from scratch based on the user's prompt.
      const priorStyle = loadOrBuildState(jobDir, rawFile, styles).style;
      state = {
        transcription: fullTranscription,
        cuts: [],
        deletedSegments: [],
        markers: [],
        style: priorStyle,
        updatedAt: new Date().toISOString(),
      };
      durationContext =
        `\n\n# CONTEXTE SOURCE\n` +
        `Video source ORIGINALE: ${originalDuration.toFixed(1)}s (${fullTranscription.length} entrees ci-dessus).\n` +
        `Version actuelle ${rawFile}: ${currentDuration.toFixed(1)}s d'extrait.\n` +
        `\n# FORMAT DE REPONSE COMPACT — IMPORTANT\n` +
        `Pour les changements de cut/duree, utilise EXCLUSIVEMENT le champ \`keepRanges\` (liste de fenetres temporelles a GARDER, en secondes du timeline original) :\n` +
        `\`\`\`\n"changes": { "keepRanges": [ {"start": 5.2, "end": 18.4}, {"start": 95.0, "end": 130.5} ] }\n\`\`\`\n` +
        `Le serveur calcule automatiquement les cuts et les segments a supprimer. NE LISTE PAS individuellement les wordIds ou segmentIds — c'est trop verbeux et echoue (max_tokens depasse).\n` +
        `\n# OBJECTIF DUREE\n` +
        `- "PLUS LONG" / "rallonge" / "+15s" / "60s" → ajoute plus de fenetres OU elargis les fenetres existantes.\n` +
        `- "PLUS COURT" / "fais 20s" → reduis le nombre / la taille des fenetres.\n` +
        `- Pas de duree mentionnee → garde ~${Math.round(currentDuration)}s.\n` +
        `Selectionne les meilleurs moments (hook + punchline + transitions claires). Evite hesitations / silences > 0.4s entre fenetres en placant des coupes propres.`;
    } else {
      state = loadOrBuildState(jobDir, rawFile, styles);
      if (!state.transcription || state.transcription.length === 0) {
        return NextResponse.json(
          { error: "Aucune transcription disponible pour ce fichier — impossible de retravailler." },
          { status: 400 }
        );
      }
    }

    const stylesJson = JSON.stringify(styles);
    const systemPrompt = buildEditorReworkSystem({ stylesJson });
    const userMsg = buildEditorReworkUserMessage({ state, userMessage: userPrompt + durationContext });

    const res = await fetch(KIMI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
        temperature: 1,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Kimi API error ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || "";
    const parsed = extractJson(rawContent);
    if (!parsed) {
      return NextResponse.json(
        { error: `Kimi reponse invalide: ${rawContent.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const reply = typeof parsed.reply === "string" ? parsed.reply : "(pas de reponse)";
    const hasChanges = parsed.changes && Object.keys(parsed.changes).length > 0;
    if (!hasChanges) {
      return NextResponse.json(
        { error: `Kimi n'a propose aucun changement: ${reply}` },
        { status: 422 }
      );
    }

    const renderSourceDuration = fullMode ? originalDuration : currentDuration;
    const nextState = applyChanges(state, parsed.changes!, styles, renderSourceDuration);

    // Persist updated state under the RAW filename so future reworks compose on it
    const editsDir = path.join(jobDir, "edits");
    fs.mkdirSync(editsDir, { recursive: true });
    fs.writeFileSync(
      path.join(editsDir, `${rawFile}.json`),
      JSON.stringify(nextState, null, 2)
    );

    // Render against the original input in fullMode (default), else the cut.
    const result = await renderEditorOutput({
      jobId: id,
      sourceFile: rawFile,
      editorState: nextState,
      burnSubtitles: true,
      projectRoot: cwd,
      ffmpegPath,
      sourceVideoPathOverride: fullMode && originalInputPath ? originalInputPath : undefined,
    });

    return NextResponse.json({
      ok: true,
      reply,
      videoFile: result.videoFile,
      version: result.version,
      duration: result.duration,
      sourceFile: rawFile,
      fullMode,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[QUICK REWORK] Error:", error);
    return NextResponse.json(
      { error: error.message || "Quick rework failed" },
      { status: 500 }
    );
  }
}
