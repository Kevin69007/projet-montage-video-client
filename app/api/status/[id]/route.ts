import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const jobDir = path.join(process.cwd(), "jobs", jobId);
  const statusPath = path.join(jobDir, "status.json");

  if (!fs.existsSync(statusPath)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));

  // Merge in fresh outputs.json so editor-rendered versions appear without re-running pipeline
  const outputsPath = path.join(jobDir, "outputs.json");
  if (fs.existsSync(outputsPath)) {
    try {
      const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf-8"));
      if (Array.isArray(outputs)) {
        const outputDir = path.join(jobDir, "output");
        // Filter to outputs whose files actually exist on disk AND have content.
        // Skips zero-byte placeholders left by reserveNextVersion if a render
        // was killed mid-flight before copyFileSync ran.
        status.outputs = outputs.filter((o: { file?: unknown }) => {
          if (typeof o?.file !== "string") return false;
          const p = path.join(outputDir, o.file);
          if (!fs.existsSync(p)) return false;
          try {
            return fs.statSync(p).size > 0;
          } catch {
            return false;
          }
        });
      }
    } catch (e) {
      console.error("Failed to merge outputs.json into status:", e);
    }
  }

  return NextResponse.json(status);
}
