"use client";

interface Segment {
  id: string;
  start: number;
  end: number;
  deleted: boolean;
}

interface SegmentsListProps {
  segments: Segment[];
  currentTime: number;
  onToggleDelete: (segId: string) => void;
  onSeek: (time: number) => void;
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function SegmentsList({
  segments,
  currentTime,
  onToggleDelete,
  onSeek,
}: SegmentsListProps) {
  if (segments.length === 0) {
    return null;
  }

  const totalKept = segments
    .filter((s) => !s.deleted)
    .reduce((acc, s) => acc + (s.end - s.start), 0);
  const totalDeleted = segments
    .filter((s) => s.deleted)
    .reduce((acc, s) => acc + (s.end - s.start), 0);

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="mono-label">Segments</div>
        <div className="text-xs font-mono text-text-muted">
          {segments.filter((s) => !s.deleted).length} gardes ·{" "}
          {segments.filter((s) => s.deleted).length} supprimes ·{" "}
          <span className="text-purple-light">{fmt(totalKept)}</span> final
          {totalDeleted > 0 && (
            <span className="text-red-400 ml-1">(−{fmt(totalDeleted)})</span>
          )}
        </div>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {segments.map((seg) => {
          const isCurrent = currentTime >= seg.start && currentTime < seg.end;
          return (
            <div
              key={seg.id}
              className={`flex items-center gap-2 px-3 py-2 border transition-colors ${
                seg.deleted
                  ? "border-red-500/30 bg-red-500/5"
                  : isCurrent
                    ? "border-purple bg-purple/10"
                    : "border-glass-border"
              }`}
            >
              <button
                onClick={() => onSeek(seg.start)}
                className="font-mono text-xs text-text-muted hover:text-purple-light shrink-0"
              >
                {fmt(seg.start)} → {fmt(seg.end)}
              </button>
              <span className="text-xs text-text-body flex-1">
                {(seg.end - seg.start).toFixed(1)}s
              </span>
              <button
                onClick={() => onToggleDelete(seg.id)}
                className={`text-xs px-2 py-0.5 transition-colors ${
                  seg.deleted
                    ? "text-purple-light hover:text-purple"
                    : "text-text-muted hover:text-red-400"
                }`}
              >
                {seg.deleted ? "↩ Restaurer" : "✕ Supprimer"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
