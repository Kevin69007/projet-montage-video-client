import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

/**
 * POST /api/editor/[id]/[file]/save
 * Body: EditorState (transcription, cuts, deletedSegments, markers, style, updatedAt)
 *
 * Persists the user's editor state to jobs/{id}/edits/{file}.json
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  try {
    const { id, file } = await params;
    const decodedFile = decodeURIComponent(file);
    const body = await req.json();

    // Basic validation
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (!Array.isArray(body.transcription)) {
      return NextResponse.json({ error: "Missing transcription[]" }, { status: 400 });
    }

    const cwd = /*turbopackIgnore: true*/ process.cwd();
    const jobDir = path.join(cwd, "jobs", id);
    if (!fs.existsSync(jobDir)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const editsDir = path.join(jobDir, "edits");
    fs.mkdirSync(editsDir, { recursive: true });

    const editsPath = path.join(editsDir, `${decodedFile}.json`);
    const persisted = {
      ...body,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(editsPath, JSON.stringify(persisted, null, 2));

    return NextResponse.json({ ok: true, savedAt: persisted.updatedAt });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[EDITOR SAVE] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save edits" },
      { status: 500 }
    );
  }
}
