import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files uploaded" },
        { status: 400 }
      );
    }

    const jobId = uuidv4();
    const jobDir = path.join(process.cwd(), "jobs", jobId);
    const inputDir = path.join(jobDir, "input");
    fs.mkdirSync(inputDir, { recursive: true });

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

    const fileNames: string[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = path.join(inputDir, fileName);
      fs.writeFileSync(filePath, buffer);
      fileNames.push(fileName);
    }

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
