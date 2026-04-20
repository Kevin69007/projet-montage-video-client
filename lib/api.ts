const API_BASE = "";

export async function uploadFiles(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<{ jobId: string; files: string[] }> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Reponse invalide du serveur"));
        }
      } else if (xhr.status === 499 || xhr.status === 0) {
        reject(new Error("Upload timeout — le fichier est trop volumineux ou la connexion trop lente. Essaie avec un fichier plus petit."));
      } else if (!xhr.responseText) {
        reject(new Error(`Upload echoue (erreur ${xhr.status}) — le serveur n'a pas repondu`));
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || `Upload echoue (${xhr.status})`));
        } catch {
          reject(new Error(`Upload echoue (${xhr.status})`));
        }
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Upload echoue — erreur reseau. Verifie ta connexion.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload annule")));

    xhr.open("POST", `${API_BASE}/api/upload`);
    xhr.send(formData);
  });
}

export async function startProcessing(params: {
  jobId: string;
  prompt: string;
  mode: "video" | "miniature";
  style: string;
  accentColor?: string;
  videoType: string;
  duration: number;
  format: string;
  language: string;
  thumbnailCount?: number;
  thumbnailText?: string;
  thumbnailFormat?: string;
  referenceFileName?: string;
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
