import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

function findClaude(): string | null {
  const home = process.env.HOME || "";
  const candidates = [
    path.join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, prompt, mode, style, accentColor, videoType, duration, format, language, thumbnailCount, thumbnailText, referenceFileName } = body;

    if (!jobId || !prompt) {
      return NextResponse.json(
        { error: "jobId and prompt are required" },
        { status: 400 }
      );
    }

    // Check Claude CLI is available
    const claudePath = findClaude();
    if (!claudePath) {
      return NextResponse.json(
        { error: "Claude CLI non trouve. Installe-le et lance 'claude login'. Voir INSTALL.md" },
        { status: 500 }
      );
    }

    const jobDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "jobs", jobId);
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
        mode: mode || "video",
        style: style || "hormozi",
        accentColor: accentColor || "",
        videoType: videoType || "teaser",
        duration: duration || 30,
        format: format || "9:16",
        language: language || "fr",
        thumbnailCount: thumbnailCount || 2,
        thumbnailText: thumbnailText || "",
        referenceFileName: referenceFileName || "",
        fileNames,
      })
    );

    // Spawn worker as a detached shell command
    const { spawn } = await import("child_process");
    const cmd = ["node", path.join(/*turbopackIgnore: true*/ process.cwd(), "worker.mjs"), jobId].join(" ");

    console.log(`[PROCESS] Spawning: ${cmd}`);

    const child = spawn(cmd, {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      shell: true,
      env: { ...process.env },
    });

    child.on("error", (err) => {
      console.error(`[PROCESS] Worker error for ${jobId}:`, err);
    });

    child.unref();

    console.log(`[PROCESS] Worker PID=${child.pid} for ${jobId}`);

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
