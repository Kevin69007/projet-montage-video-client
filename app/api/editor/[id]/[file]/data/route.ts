import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

/**
 * GET /api/editor/[id]/[file]/data
 *
 * Returns everything the editor needs to load a single video:
 * - videoUrl: streaming URL (resolved via /api/download)
 * - transcription: word/silence array from the cleaned transcription JSON
 * - styles: subtitle style presets from pipeline/styles.json
 * - savedEdits: persisted user edits (or null if none yet — Phase 3)
 * - subtitlesBurned: whether subtitles are already burned (no editing then)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  try {
    const { id, file } = await params;
    const decodedFile = decodeURIComponent(file);

    const cwd = /*turbopackIgnore: true*/ process.cwd();
    const jobDir = path.join(cwd, "jobs", id);
    const outputDir = path.join(jobDir, "output");
    const editsDir = path.join(jobDir, "edits");

    if (!fs.existsSync(outputDir)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const videoPath = path.join(outputDir, decodedFile);
    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ error: "Video file not found" }, { status: 404 });
    }

    // Read outputs.json to find the transcription path + subtitlesBurned flag
    const outputsPath = path.join(jobDir, "outputs.json");
    let transcriptionFile: string | null = null;
    let subtitlesBurned = false;
    let label = decodedFile;
    let description = "";

    if (fs.existsSync(outputsPath)) {
      try {
        const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf-8"));
        const entry = Array.isArray(outputs) && outputs.find((o) => o.file === decodedFile);
        if (entry) {
          transcriptionFile = typeof entry.transcription === "string" ? entry.transcription : null;
          subtitlesBurned = entry.subtitlesBurned === true;
          label = entry.label || decodedFile;
          description = entry.description || "";
        }
      } catch (e) {
        console.error("Failed to parse outputs.json:", e);
      }
    }

    // Load transcription JSON (returns empty array if not present)
    let transcription: unknown[] = [];
    if (transcriptionFile) {
      const transcriptionPath = path.join(outputDir, transcriptionFile);
      if (fs.existsSync(transcriptionPath)) {
        try {
          transcription = JSON.parse(fs.readFileSync(transcriptionPath, "utf-8"));
        } catch (e) {
          console.error("Failed to parse transcription:", e);
        }
      }
    }

    // Load styles from pipeline/styles.json
    let styles: Record<string, unknown> = {};
    const stylesPath = path.join(cwd, "pipeline", "styles.json");
    if (fs.existsSync(stylesPath)) {
      try {
        styles = JSON.parse(fs.readFileSync(stylesPath, "utf-8"));
      } catch (e) {
        console.error("Failed to parse styles.json:", e);
      }
    }

    // Load saved edits if they exist (Phase 3+)
    let savedEdits: unknown = null;
    const editsPath = path.join(editsDir, `${decodedFile}.json`);
    if (fs.existsSync(editsPath)) {
      try {
        savedEdits = JSON.parse(fs.readFileSync(editsPath, "utf-8"));
      } catch (e) {
        console.error("Failed to parse edits:", e);
      }
    }

    // Load chat history if it exists (Phase 5)
    let chatHistory: unknown[] = [];
    const chatPath = path.join(jobDir, "chats", `${decodedFile}.json`);
    if (fs.existsSync(chatPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(chatPath, "utf-8"));
        if (Array.isArray(parsed)) chatHistory = parsed;
      } catch (e) {
        console.error("Failed to parse chat history:", e);
      }
    }

    return NextResponse.json({
      jobId: id,
      file: decodedFile,
      label,
      description,
      videoUrl: `/api/download/${id}/${encodeURIComponent(decodedFile)}`,
      transcription,
      styles,
      savedEdits,
      chatHistory,
      subtitlesBurned,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[EDITOR DATA] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load editor data" },
      { status: 500 }
    );
  }
}
