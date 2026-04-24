"use client";

import { useRef } from "react";

interface TimelineProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Timeline({ currentTime, duration, onSeek }: TimelineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current || duration <= 0) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * duration;
    onSeek(Math.max(0, Math.min(duration, t)));
  };

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        onClick={handleClick}
        className="relative h-2 bg-bg-tertiary cursor-pointer overflow-hidden"
      >
        <div
          className="absolute left-0 top-0 h-full transition-[width] duration-100"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #6C2BD9, #C67651)",
          }}
        />
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
