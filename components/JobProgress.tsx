"use client";

import type { JobStatus } from "@/lib/api";

interface JobProgressProps {
  status: JobStatus;
}

const PIPELINE_STEPS = [
  "Initialisation",
  "Analyse video",
  "Transcription",
  "Decoupe",
  "Suppression silences",
  "Extraction frame",
  "Sous-titres",
  "Text frame",
  "Assemblage",
  "Sauvegarde",
  "Termine",
];

export default function JobProgress({ status }: JobProgressProps) {
  const currentStepIndex = PIPELINE_STEPS.findIndex(
    (s) => s === status.step
  );

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="mono-label">{status.step || "En attente"}</span>
          <span className="mono-label">{status.progress}%</span>
        </div>
        <div className="w-full h-1 bg-bg-tertiary">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              width: `${status.progress}%`,
              background:
                "linear-gradient(90deg, #6C2BD9, #C67651)",
            }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {PIPELINE_STEPS.map((step, i) => {
          let stepClass = "step-pending";
          let icon = "\u25CB"; // ○
          if (i < currentStepIndex) {
            stepClass = "step-completed";
            icon = "\u2713"; // ✓
          } else if (i === currentStepIndex && status.status === "processing") {
            stepClass = "step-active";
            icon = "\u25CF"; // ●
          }

          return (
            <div key={step} className={`flex items-center gap-3 ${stepClass}`}>
              <span className="font-mono text-xs w-4 text-center">{icon}</span>
              <span className="text-sm">{step}</span>
            </div>
          );
        })}
      </div>

      {/* Activity log */}
      {status.log.length > 0 && (
        <div>
          <label className="mono-label block mb-2">Log</label>
          <div className="glass-card p-4 max-h-48 overflow-y-auto">
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

      {/* Error */}
      {status.status === "error" && (
        <div className="border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{status.message}</p>
        </div>
      )}
    </div>
  );
}
