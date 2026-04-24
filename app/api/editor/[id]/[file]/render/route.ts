import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { renderEditorOutput } from "@/lib/editor/render";
import type { EditorState } from "@/lib/editor/types";

export const runtime = "nodejs";
export const maxDuration = 600;

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

/**
 * POST /api/editor/[id]/[file]/render
 * Body: { state: EditorState, burnSubtitles: boolean }
 *
 * Produces a new video version applying the user's edits.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  try {
    const { id, file } = await params;
    const decodedFile = decodeURIComponent(file);

    const body = await req.json();
    const state = body.state as EditorState | undefined;
    const shouldBurn: boolean = body.burnSubtitles === true;

    if (!state || !Array.isArray(state.transcription)) {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }

    const cwd = /*turbopackIgnore: true*/ process.cwd();
    const jobDir = path.join(cwd, "jobs", id);
    if (!fs.existsSync(jobDir)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const result = await renderEditorOutput({
      jobId: id,
      sourceFile: decodedFile,
      editorState: state,
      burnSubtitles: shouldBurn,
      projectRoot: cwd,
      ffmpegPath: findFfmpeg(),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[EDITOR RENDER] Error:", error);
    return NextResponse.json(
      { error: error.message || "Render failed" },
      { status: 500 }
    );
  }
}
