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
        // Filter to outputs whose files actually exist on disk
        status.outputs = outputs.filter((o: { file?: unknown }) => {
          if (typeof o?.file !== "string") return false;
          return fs.existsSync(path.join(outputDir, o.file));
        });
      }
    } catch (e) {
      console.error("Failed to merge outputs.json into status:", e);
    }
  }

  return NextResponse.json(status);
}
