"use client";

import type { TranscriptEntry } from "@/lib/editor/types";

interface TranscriptPanelProps {
  transcription: TranscriptEntry[];
  currentTime: number;
  onSeek: (time: number) => void;
}

export default function TranscriptPanel({
  transcription,
  currentTime,
  onSeek,
}: TranscriptPanelProps) {
  return (
    <div className="glass-card p-4 max-h-[60vh] overflow-y-auto">
      <div className="mono-label mb-3">Transcription</div>
      <div className="text-sm leading-relaxed">
        {transcription.length === 0 ? (
          <p className="text-text-muted">Aucune transcription disponible.</p>
        ) : (
          transcription.map((entry) => {
            const isActive =
              currentTime >= entry.start && currentTime < entry.end;

            if (entry.type === "silence") {
              return (
                <button
                  key={entry.id}
                  onClick={() => onSeek(entry.start)}
                  className={`inline-block px-1.5 py-0.5 mx-0.5 my-0.5 text-xs font-mono opacity-50 hover:opacity-100 transition-opacity ${
                    isActive ? "text-orange" : "text-text-muted"
                  }`}
                  title={`Silence ${entry.duration.toFixed(2)}s @ ${entry.start.toFixed(2)}s`}
                >
                  ⏸ {entry.duration.toFixed(1)}s
                </button>
              );
            }

            return (
              <button
                key={entry.id}
                onClick={() => onSeek(entry.start)}
                className={`inline px-0.5 mx-0.5 transition-colors cursor-pointer ${
                  isActive
                    ? "bg-purple text-white"
                    : entry.deleted
                      ? "line-through opacity-40"
                      : "text-text-body hover:text-purple-light"
                }`}
                title={`@ ${entry.start.toFixed(2)}s`}
              >
                {entry.word}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
