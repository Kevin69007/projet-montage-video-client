"use client";

import { useState } from "react";
import type { Marker } from "@/lib/editor/types";

interface MarkersPanelProps {
  markers: Marker[];
  currentTime: number;
  onAdd: (time: number, comment: string) => void;
  onRemove: (id: string) => void;
  onSeek: (time: number) => void;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function MarkersPanel({
  markers,
  currentTime,
  onAdd,
  onRemove,
  onSeek,
}: MarkersPanelProps) {
  const [comment, setComment] = useState("");

  const handleAdd = () => {
    const text = comment.trim();
    if (!text) return;
    onAdd(currentTime, text);
    setComment("");
  };

  const sorted = [...markers].sort((a, b) => a.time - b.time);

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="mono-label">Marqueurs / Commentaires</div>

      <div className="flex gap-2">
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={`Ajouter a ${fmt(currentTime)}...`}
          className="glass-input flex-1 text-xs py-1.5"
        />
        <button
          onClick={handleAdd}
          disabled={!comment.trim()}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          + Ajouter
        </button>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="text-xs text-text-muted italic">Aucun marqueur. Pose des commentaires pour guider le rework IA.</p>
        ) : (
          sorted.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-2 p-2 border ${
                m.resolved
                  ? "border-glass-border opacity-50"
                  : m.author === "user"
                    ? "border-orange/30 bg-orange/5"
                    : "border-purple/30 bg-purple/5"
              }`}
            >
              <button
                onClick={() => onSeek(m.time)}
                className="font-mono text-[10px] text-text-muted hover:text-purple-light shrink-0"
                title="Aller a"
              >
                {fmt(m.time)}
              </button>
              <span className="text-xs text-text-body flex-1 break-words">{m.comment}</span>
              {!m.resolved && (
                <button
                  onClick={() => onRemove(m.id)}
                  className="text-text-muted hover:text-red-400 text-sm shrink-0"
                  title="Supprimer"
                >
                  ×
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
