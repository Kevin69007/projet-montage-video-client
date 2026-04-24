"use client";

import type { TranscriptEntry } from "@/lib/editor/types";

interface TranscriptPanelProps {
  transcription: TranscriptEntry[];
  currentTime: number;
  editable?: boolean;
  onSeek: (time: number) => void;
  onToggleWordDeleted?: (id: string) => void;
  onToggleSilenceDeleted?: (id: string) => void;
  onTrimSilence?: (id: string, trimTo: number | null) => void;
  onToggleLineBreak?: (id: string) => void;
}

export default function TranscriptPanel({
  transcription,
  currentTime,
  editable = true,
  onSeek,
  onToggleWordDeleted,
  onToggleSilenceDeleted,
  onTrimSilence,
  onToggleLineBreak,
}: TranscriptPanelProps) {
  const deletedCount = transcription.filter(
    (e) => e.type === "word" && e.deleted
  ).length;
  const trimmedCount = transcription.filter(
    (e) => e.type === "silence" && (e.deleted || e.trimTo !== null)
  ).length;

  return (
    <div className="glass-card p-4 max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="mono-label">Transcription</div>
        {editable && (deletedCount > 0 || trimmedCount > 0) && (
          <div className="text-[10px] font-mono text-text-muted">
            {deletedCount > 0 && <span>{deletedCount} mots</span>}
            {deletedCount > 0 && trimmedCount > 0 && " · "}
            {trimmedCount > 0 && <span>{trimmedCount} silences</span>}
          </div>
        )}
      </div>
      <div className="text-sm leading-relaxed">
        {transcription.length === 0 ? (
          <p className="text-text-muted">Aucune transcription disponible.</p>
        ) : (
          transcription.map((entry) => {
            const isActive =
              currentTime >= entry.start && currentTime < entry.end;

            if (entry.type === "silence") {
              const trimText = entry.trimTo !== null && entry.trimTo !== undefined
                ? `${entry.trimTo.toFixed(1)}s`
                : `${entry.duration.toFixed(1)}s`;
              return (
                <span key={entry.id} className="inline-flex items-center gap-1 mx-1">
                  <button
                    onClick={() => onSeek(entry.start)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (editable && onTrimSilence) {
                        const v = window.prompt(
                          `Trim silence to (s) - laisser vide pour reset:`,
                          entry.trimTo?.toString() || ""
                        );
                        if (v === null) return;
                        if (v.trim() === "") {
                          onTrimSilence(entry.id, null);
                        } else {
                          const num = parseFloat(v);
                          if (Number.isFinite(num) && num >= 0) {
                            onTrimSilence(entry.id, num);
                          }
                        }
                      }
                    }}
                    className={`text-[10px] font-mono px-1.5 py-0.5 transition-colors ${
                      entry.deleted
                        ? "line-through opacity-30"
                        : isActive
                          ? "text-orange"
                          : "text-text-muted opacity-60 hover:opacity-100"
                    }`}
                    title={editable ? "Click: aller a · Right-click: trim · Long press: ..." : `Silence ${entry.duration.toFixed(2)}s`}
                  >
                    ⏸ {trimText}
                  </button>
                  {editable && onToggleSilenceDeleted && (
                    <button
                      onClick={() => onToggleSilenceDeleted(entry.id)}
                      className="text-[10px] text-text-muted hover:text-red-400 opacity-50 hover:opacity-100"
                      title={entry.deleted ? "Restaurer" : "Supprimer"}
                    >
                      {entry.deleted ? "↩" : "✕"}
                    </button>
                  )}
                </span>
              );
            }

            return (
              <button
                key={entry.id}
                onClick={() => onSeek(entry.start)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (editable && onToggleLineBreak) onToggleLineBreak(entry.id);
                }}
                onDoubleClick={() => {
                  if (editable && onToggleWordDeleted) onToggleWordDeleted(entry.id);
                }}
                className={`inline px-0.5 mx-0.5 transition-colors cursor-pointer ${
                  isActive
                    ? "bg-purple text-white"
                    : entry.deleted
                      ? "line-through opacity-40 text-red-400"
                      : "text-text-body hover:text-purple-light"
                } ${entry.lineBreak ? "border-r-2 border-purple/40 pr-1.5 mr-0" : ""}`}
                title={
                  editable
                    ? `@${entry.start.toFixed(2)}s · click: seek · double-click: ${entry.deleted ? "restaurer" : "supprimer"} · right-click: line break`
                    : `@ ${entry.start.toFixed(2)}s`
                }
              >
                {entry.word}
              </button>
            );
          })
        )}
      </div>
      {editable && (
        <p className="text-[10px] text-text-muted opacity-60 mt-3 italic">
          Double-clic = supprimer/restaurer · Clic droit sur mot = saut de ligne · Clic droit sur silence = trim
        </p>
      )}
    </div>
  );
}
