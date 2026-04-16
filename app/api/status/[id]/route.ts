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
  return NextResponse.json(status);
}
