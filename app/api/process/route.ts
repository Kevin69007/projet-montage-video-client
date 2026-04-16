import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, prompt, style, accentColor } = body;

    if (!jobId || !prompt) {
      return NextResponse.json(
        { error: "jobId and prompt are required" },
        { status: 400 }
      );
    }

    const jobDir = path.join(process.cwd(), "jobs", jobId);
    const inputDir = path.join(jobDir, "input");

    if (!fs.existsSync(inputDir)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get list of uploaded files
    const fileNames = fs.readdirSync(inputDir);
    if (fileNames.length === 0) {
      return NextResponse.json(
        { error: "No files in job" },
        { status: 400 }
      );
    }

    // Start the agent in the background (fire and forget)
    runAgent(jobId, prompt, fileNames, style || "hormozi", accentColor).catch(
      (err) => {
        console.error(`Agent error for job ${jobId}:`, err);
        const statusPath = path.join(jobDir, "status.json");
        const status = fs.existsSync(statusPath)
          ? JSON.parse(fs.readFileSync(statusPath, "utf-8"))
          : {};
        status.status = "error";
        status.step = "Erreur";
        status.message = err.message || "Erreur inconnue";
        status.log = [
          ...(status.log || []),
          `[${new Date().toISOString()}] ERREUR: ${err.message}`,
        ];
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
      }
    );

    return NextResponse.json({ ok: true, jobId });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { error: error.message || "Process failed" },
      { status: 500 }
    );
  }
}
