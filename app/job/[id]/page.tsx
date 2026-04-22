"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import JobProgress from "@/components/JobProgress";
import VideoResults from "@/components/VideoResults";
import { getJobStatus, type JobStatus } from "@/lib/api";

export default function JobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getJobStatus(jobId);
      setStatus(data);
    } catch {
      setError("Impossible de recuperer le statut");
    }
  }, [jobId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Stop polling when done or error
  useEffect(() => {
    if (status?.status === "done" || status?.status === "error") {
      // Final fetch to get latest data
      fetchStatus();
    }
  }, [status?.status, fetchStatus]);

  const isDone = status?.status === "done";
  const isError = status?.status === "error";

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-glass-border">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="heading-xl text-2xl sm:text-3xl">
              {isDone ? "Resultats" : isError ? "Erreur" : "Processing"}
            </h1>
            <p className="text-xs text-text-muted mt-1 font-mono">{jobId}</p>
          </div>
          <button onClick={() => router.push("/")} className="btn-ghost text-sm">
            Nouveau montage
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        {error && (
          <div className="border border-red-500/30 bg-red-500/5 p-4 mb-6">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {!status && !error && (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-purple border-t-transparent animate-spin" />
            <p className="text-sm text-text-muted mt-4">Chargement...</p>
          </div>
        )}

        {status && !isDone && <JobProgress status={status} />}

        {status && isDone && (
          <>
            <VideoResults
              jobId={jobId}
              outputs={status.outputs}
              message={status.message}
            />

            {/* Token usage */}
            {status.tokens && (
              <div className="mt-8">
                <label className="mono-label block mb-2">Usage Kimi</label>
                <div className="glass-card p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="mono-label text-[10px] opacity-60">Modele</p>
                      <p className="text-sm font-mono text-text-primary mt-1">{status.tokens.model}</p>
                    </div>
                    <div>
                      <p className="mono-label text-[10px] opacity-60">Input tokens</p>
                      <p className="text-sm font-mono text-text-primary mt-1">{status.tokens.input.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="mono-label text-[10px] opacity-60">Output tokens</p>
                      <p className="text-sm font-mono text-text-primary mt-1">{status.tokens.output.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="mono-label text-[10px] opacity-60">Cout estime</p>
                      <p className="text-sm font-mono text-purple-light mt-1">${status.tokens.estimated_cost_usd.toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status.log.length > 0 && (
              <div className="mt-8">
                <label className="mono-label block mb-2">Log</label>
                <div className="glass-card p-4 max-h-64 overflow-y-auto">
                  {status.log.map((entry, i) => (
                    <p
                      key={i}
                      className="text-xs text-text-muted font-mono leading-relaxed"
                    >
                      {entry}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
