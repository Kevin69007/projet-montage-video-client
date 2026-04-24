"use client";

/**
 * Live subtitle overlay — renders the active word(s) on top of the video.
 * Ported from review/player.html renderSubOverlay() (lines 1624-1789).
 *
 * Algorithm:
 * 1. Filter out deleted words.
 * 2. Find active word (currentTime ∈ [start, end]) or closest preceding.
 * 3. Build chunk: lines × wpl words around active word, respecting manual line breaks.
 * 4. Render each word with style-specific color/outline/shadow rules.
 */

import { useMemo } from "react";
import type {
  AppliedSubtitleStyle,
  TranscriptEntry,
  TranscriptWord,
} from "@/lib/editor/types";

interface SubtitleOverlayProps {
  transcription: TranscriptEntry[];
  style: AppliedSubtitleStyle;
  currentTime: number;
  visible?: boolean;
}

export default function SubtitleOverlay({
  transcription,
  style,
  currentTime,
  visible = true,
}: SubtitleOverlayProps) {
  const words = useMemo(
    () =>
      transcription.filter(
        (e): e is TranscriptWord => e.type === "word" && !e.deleted
      ),
    [transcription]
  );

  if (!visible || !style.config || words.length === 0) {
    return null;
  }

  const cfg = style.config;
  const fontSize = style.sizeOverride || cfg.size;
  const wpl = style.wpl || cfg.wordsPerLine || 3;
  const lines = style.lines || 2;
  const accent = style.accentColor || cfg.accentColor;
  const hasManualBreaks = words.some((w) => w.lineBreak);

  // 1) Find active word index
  let activeIdx = words.findIndex(
    (w) => currentTime >= w.start && currentTime < w.end
  );
  if (activeIdx < 0) {
    // Between words → closest preceding
    for (let i = 0; i < words.length; i++) {
      if (words[i].start > currentTime) {
        activeIdx = Math.max(0, i - 1);
        break;
      }
    }
  }
  if (activeIdx < 0) {
    // Past all words: hide
    if (currentTime >= words[words.length - 1].end) return null;
    activeIdx = words.length - 1;
  }

  // 2) Build chunk
  let chunk: TranscriptWord[];
  let chunkBreaks: number[] = []; // indices where line breaks go

  if (hasManualBreaks) {
    // Split into line-groups by lineBreak markers
    const lineGroups: TranscriptWord[][] = [];
    let g: TranscriptWord[] = [];
    for (const w of words) {
      g.push(w);
      if (w.lineBreak) {
        lineGroups.push(g);
        g = [];
      }
    }
    if (g.length) lineGroups.push(g);

    // Find which line-group contains active word
    let activeLineIdx = lineGroups.length - 1;
    for (let i = 0; i < lineGroups.length; i++) {
      if (lineGroups[i].some((w) => words.indexOf(w) === activeIdx)) {
        activeLineIdx = i;
        break;
      }
    }

    // Grab `lines` consecutive line-groups
    const blockStart = Math.floor(activeLineIdx / lines) * lines;
    chunk = [];
    for (let i = blockStart; i < Math.min(blockStart + lines, lineGroups.length); i++) {
      if (chunk.length > 0) chunkBreaks.push(chunk.length);
      chunk = chunk.concat(lineGroups[i]);
    }
  } else {
    // Auto: blocks of (lines × wpl) words
    const blockSize = lines * wpl;
    const groups: TranscriptWord[][] = [];
    for (let i = 0; i < words.length; i += blockSize) {
      groups.push(words.slice(i, Math.min(i + blockSize, words.length)));
    }
    chunk = groups[groups.length - 1];
    for (const grp of groups) {
      if (grp.some((w) => words.indexOf(w) === activeIdx)) {
        chunk = grp;
        break;
      }
    }
    // Insert breaks every wpl words
    chunkBreaks = [];
    for (let i = wpl; i < chunk.length; i += wpl) {
      chunkBreaks.push(i);
    }
  }

  // 3) Position styling
  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    top: `${style.posY}%`,
    pointerEvents: "none",
    textAlign: "center",
    width: "90%",
    maxWidth: "90%",
    zIndex: 10,
    lineHeight: 1.2,
  };

  // Background box for boxed/karaoke styles
  const innerStyle: React.CSSProperties = {
    display: "inline-block",
    padding: cfg.background?.padding || "0",
    background: cfg.background?.color || "transparent",
    borderRadius: cfg.background ? `${cfg.background.borderRadius}px` : "0",
  };

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        {chunk.map((w, idx) => {
          const isActive = currentTime >= w.start && currentTime < w.end;
          const isUpper = cfg.textTransform === "uppercase";

          // Color logic per animation type
          let color = isActive ? accent : cfg.color;
          let textShadow: string | undefined;
          if (cfg.animation === "color-fill") {
            // Karaoke: dim → bright
            color = isActive ? accent : cfg.dimColor || "#666";
            if (isActive && cfg.glow) {
              textShadow = `0 0 ${cfg.glow.radius}px ${accent}`;
            }
          } else if (cfg.animation === "glitch") {
            // Neon: all colored with glow
            const gc = isActive ? accent : cfg.color;
            color = isActive ? cfg.color : cfg.color;
            textShadow = `0 0 10px ${gc}, 0 0 20px ${gc}, 0 0 40px ${gc}`;
          } else if (isActive && (cfg.animation === "scale-pop" || cfg.animation === "hard-pop")) {
            textShadow = `0 0 8px ${accent}, 0 0 16px ${accent}44`;
          } else if (cfg.shadow) {
            textShadow = `${cfg.shadow.x}px ${cfg.shadow.y}px ${cfg.shadow.blur}px ${cfg.shadow.color}`;
          }

          const wordStyle: React.CSSProperties = {
            display: "inline-block",
            fontFamily: `${cfg.font}, system-ui, sans-serif`,
            fontWeight: cfg.weight as React.CSSProperties["fontWeight"],
            fontSize: `${fontSize}px`,
            color,
            letterSpacing: "0.02em",
            margin: "0 0.15em",
            textShadow,
            textTransform: isUpper ? "uppercase" : "none",
            ...(cfg.outline
              ? {
                  WebkitTextStroke: `${cfg.outline.width}px ${cfg.outline.color}`,
                  paintOrder: "stroke fill",
                }
              : {}),
          };

          return (
            <span key={`${w.id}-${idx}`}>
              <span style={wordStyle}>{w.word}</span>
              {chunkBreaks.includes(idx + 1) && <br />}
            </span>
          );
        })}
      </div>
    </div>
  );
}
