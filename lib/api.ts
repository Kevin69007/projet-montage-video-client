const API_BASE = "";

export async function uploadFiles(
  files: File[]
): Promise<{ jobId: string; files: string[] }> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Upload failed");
  }

  return res.json();
}

export async function startProcessing(params: {
  jobId: string;
  prompt: string;
  style: string;
  accentColor?: string;
}): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Process failed");
  }

  return res.json();
}

export interface JobStatus {
  status: "uploaded" | "processing" | "done" | "error";
  step: string;
  progress: number;
  message: string;
  outputs: { file: string; label: string; description: string }[];
  log: string[];
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_BASE}/api/status/${jobId}`);

  if (!res.ok) {
    throw new Error("Failed to get job status");
  }

  return res.json();
}

export function getDownloadUrl(jobId: string, fileName: string): string {
  return `${API_BASE}/api/download/${jobId}/${encodeURIComponent(fileName)}`;
}
