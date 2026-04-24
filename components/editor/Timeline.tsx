"use client";

import { useRef } from "react";
import type { Marker } from "@/lib/editor/types";

interface TimelineProps {
  currentTime: number;
  duration: number;
  cuts?: number[];
  markers?: Marker[];
  deletedRanges?: Array<{ start: number; end: number }>;
  onSeek: (time: number) => void;
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Timeline({
  currentTime,
  duration,
  cuts = [],
  markers = [],
  deletedRanges = [],
  onSeek,
}: TimelineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current || duration <= 0) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * duration;
    onSeek(Math.max(0, Math.min(duration, t)));
  };

  const tx = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        onClick={handleClick}
        className="relative h-4 bg-bg-tertiary cursor-pointer overflow-hidden"
      >
        {/* Deleted ranges */}
        {deletedRanges.map((r, i) => (
          <div
            key={`del-${i}`}
            className="absolute top-0 h-full bg-red-500/40"
            style={{
              left: `${tx(r.start)}%`,
              width: `${tx(r.end - r.start)}%`,
            }}
          />
        ))}

        {/* Progress bar */}
        <div
          className="absolute left-0 top-0 h-full transition-[width] duration-100 opacity-60"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #6C2BD9, #C67651)",
          }}
        />

        {/* Cut markers */}
        {cuts.map((c, i) => (
          <div
            key={`cut-${i}`}
            className="absolute top-0 h-full w-[2px] bg-red-500"
            style={{ left: `${tx(c)}%` }}
            title={`Cut @ ${fmt(c)}`}
          />
        ))}

        {/* Marker pins */}
        {markers.map((m) => (
          <div
            key={m.id}
            className={`absolute top-0 h-full w-[3px] ${
              m.resolved
                ? "bg-text-muted"
                : m.author === "user"
                  ? "bg-orange"
                  : "bg-purple-light"
            }`}
            style={{ left: `${tx(m.time)}%` }}
            title={`${m.author === "user" ? "User" : "AI"}: ${m.comment}`}
          />
        ))}

        {/* Playhead */}
        <div
          className="absolute top-0 h-full w-[2px] bg-white"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs font-mono text-text-muted">
        <span>{fmt(currentTime)}</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}
