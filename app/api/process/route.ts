import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

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

    const fileNames = fs.readdirSync(inputDir);
    if (fileNames.length === 0) {
      return NextResponse.json(
        { error: "No files in job" },
        { status: 400 }
      );
    }

    // Write job params for the worker
    const paramsPath = path.join(jobDir, "params.json");
    fs.writeFileSync(
      paramsPath,
      JSON.stringify({
        prompt,
        style: style || "hormozi",
        accentColor: accentColor || "",
        fileNames,
      })
    );

    // Spawn worker as a detached child process
    // Use exec to avoid Turbopack trying to resolve the worker path
    const { exec: execChild } = await import("child_process");
    const workerCmd = `node ${path.join(process.cwd(), "worker.mjs")} ${jobId}`;
    console.log(`[PROCESS] Spawning worker for job ${jobId}`);

    const child = execChild(workerCmd, {
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024,
    });

    child.unref();

    console.log(`[PROCESS] Worker spawned for job ${jobId}`);

    return NextResponse.json({ ok: true, jobId });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[PROCESS] Error:", error);
    return NextResponse.json(
      { error: error.message || "Process failed" },
      { status: 500 }
    );
  }
}
