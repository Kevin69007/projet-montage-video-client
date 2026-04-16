import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data" },
        { status: 400 }
      );
    }

    const jobId = uuidv4();
    const jobDir = path.join(process.cwd(), "jobs", jobId);
    const inputDir = path.join(jobDir, "input");
    fs.mkdirSync(inputDir, { recursive: true });

    // Parse multipart form data
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files uploaded" },
        { status: 400 }
      );
    }

    const fileNames: string[] = [];

    for (const file of files) {
      const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = path.join(inputDir, fileName);

      // Stream file to disk in chunks instead of loading entirely in memory
      const fileStream = fs.createWriteStream(filePath);
      const reader = file.stream().getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end(() => resolve());
        fileStream.on("error", reject);
      });

      fileNames.push(fileName);
    }

    // Initialize status
    const statusPath = path.join(jobDir, "status.json");
    fs.writeFileSync(
      statusPath,
      JSON.stringify({
        status: "uploaded",
        step: "Upload",
        progress: 0,
        message: "Fichiers uploades",
        outputs: [],
        log: [],
      })
    );

    return NextResponse.json({ jobId, files: fileNames });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
