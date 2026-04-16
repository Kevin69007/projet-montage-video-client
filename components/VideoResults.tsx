"use client";

import { getDownloadUrl } from "@/lib/api";
import { useState } from "react";

interface VideoResultsProps {
  jobId: string;
  outputs: { file: string; label: string; description: string }[];
  message: string;
}

export default function VideoResults({
  jobId,
  outputs,
  message,
}: VideoResultsProps) {
  return (
    <div className="space-y-6">
      {/* Summary message */}
      {message && (
        <div className="glass-card p-4">
          <p className="text-sm text-text-body whitespace-pre-wrap">
            {message}
          </p>
        </div>
      )}

      {/* Output videos */}
      {outputs.map((output, i) => (
        <OutputCard key={i} jobId={jobId} output={output} index={i} />
      ))}

      {outputs.length === 0 && (
        <p className="text-text-muted text-sm">Aucun fichier de sortie.</p>
      )}
    </div>
  );
}

function OutputCard({
  jobId,
  output,
  index,
}: {
  jobId: string;
  output: { file: string; label: string; description: string };
  index: number;
}) {
  const [copied, setCopied] = useState(false);
  const url = getDownloadUrl(jobId, output.file);
  const isVideo = /\.(mp4|mov|webm)$/i.test(output.file);

  const copyDescription = () => {
    navigator.clipboard.writeText(output.description);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-purple-light">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-sm font-bold text-text-primary uppercase tracking-wide">
            {output.label}
          </span>
        </div>
        <a
          href={url}
          download={output.file}
          className="btn-ghost text-xs py-1.5 px-3"
        >
          Telecharger
        </a>
      </div>

      {/* Video player */}
      {isVideo && (
        <div className="bg-black">
          <video
            src={url}
            controls
            className="w-full max-h-[500px] mx-auto"
            preload="metadata"
          />
        </div>
      )}

      {/* Description */}
      {output.description && (
        <div className="p-4 border-t border-glass-border">
          <div className="flex items-center justify-between mb-2">
            <span className="mono-label">Description</span>
            <button
              onClick={copyDescription}
              className="text-xs text-text-muted hover:text-purple-light transition-colors"
            >
              {copied ? "Copie !" : "Copier"}
            </button>
          </div>
          <pre className="text-xs text-text-body whitespace-pre-wrap font-sans leading-relaxed">
            {output.description}
          </pre>
        </div>
      )}
    </div>
  );
}
