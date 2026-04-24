import { NextRequest, NextResponse } from "next/server";
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
const MAX_TOKENS = 6000;
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

function applyChanges(state: EditorState, changes: KimiChanges): EditorState {
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

  if (changes.style) {
    next.style = {
      ...next.style,
      ...(changes.style.accentColor !== undefined ? { accentColor: changes.style.accentColor } : {}),
      ...(changes.style.sizeOverride !== undefined ? { sizeOverride: changes.style.sizeOverride } : {}),
      ...(changes.style.posY !== undefined ? { posY: changes.style.posY } : {}),
      ...(changes.style.wpl !== undefined ? { wpl: changes.style.wpl } : {}),
      ...(changes.style.lines !== undefined ? { lines: changes.style.lines } : {}),
      ...(changes.style.aspectRatio !== undefined ? { aspectRatio: changes.style.aspectRatio } : {}),
    };
    if (changes.style.name && changes.style.name !== next.style.name) {
      // Name change is honored only as a hint — config is rebuilt elsewhere.
      next.style = { ...next.style, name: changes.style.name };
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

/**
 * POST /api/editor/[id]/[file]/quick-rework
 * Body: { userPrompt: string }
 *
 * One-shot: ask Kimi for a JSON patch from the prompt, apply it to the
 * current EditorState, persist, render with subtitles burned, return the
 * new version info.
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
    const state = loadOrBuildState(jobDir, rawFile, styles);

    if (!state.transcription || state.transcription.length === 0) {
      return NextResponse.json(
        { error: "Aucune transcription disponible pour ce fichier — impossible de retravailler." },
        { status: 400 }
      );
    }

    const stylesJson = JSON.stringify(styles);
    const systemPrompt = buildEditorReworkSystem({ stylesJson });
    const userMsg = buildEditorReworkUserMessage({ state, userMessage: userPrompt });

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

    const nextState = applyChanges(state, parsed.changes!);

    // Resolve style.config from name when name is a known style
    if (nextState.style.name && styles[nextState.style.name]) {
      nextState.style = { ...nextState.style, config: styles[nextState.style.name] };
    }

    // Persist updated state under the RAW filename so future reworks compose on it
    const editsDir = path.join(jobDir, "edits");
    fs.mkdirSync(editsDir, { recursive: true });
    fs.writeFileSync(
      path.join(editsDir, `${rawFile}.json`),
      JSON.stringify(nextState, null, 2)
    );

    // Render against the raw source with burned subtitles
    const result = await renderEditorOutput({
      jobId: id,
      sourceFile: rawFile,
      editorState: nextState,
      burnSubtitles: true,
      projectRoot: cwd,
      ffmpegPath: findFfmpeg(),
    });

    return NextResponse.json({
      ok: true,
      reply,
      videoFile: result.videoFile,
      version: result.version,
      duration: result.duration,
      sourceFile: rawFile,
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
