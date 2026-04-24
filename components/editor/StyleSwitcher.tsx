"use client";

import type { AppliedSubtitleStyle, SubtitleStyle } from "@/lib/editor/types";

interface StyleSwitcherProps {
  styles: Record<string, SubtitleStyle>;
  current: AppliedSubtitleStyle;
  showSubtitles: boolean;
  onChange: (style: AppliedSubtitleStyle) => void;
  onToggleSubtitles: (visible: boolean) => void;
}

export default function StyleSwitcher({
  styles,
  current,
  showSubtitles,
  onChange,
  onToggleSubtitles,
}: StyleSwitcherProps) {
  const styleEntries = Object.entries(styles);

  const selectStyle = (key: string) => {
    const cfg = styles[key];
    if (!cfg) return;
    onChange({
      ...current,
      name: key,
      config: cfg,
      accentColor: current.accentColor || cfg.accentColor,
      sizeOverride: current.sizeOverride,
      wpl: cfg.wordsPerLine || 3,
    });
  };

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="mono-label">Style sous-titres</div>
        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showSubtitles}
            onChange={(e) => onToggleSubtitles(e.target.checked)}
          />
          Afficher
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {styleEntries.map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => selectStyle(key)}
            className={`glass-card p-3 text-left transition-all cursor-pointer ${
              current.name === key
                ? "border-purple bg-purple/10 shadow-[0_0_12px_rgba(108,43,217,0.3)]"
                : ""
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-3 h-3"
                style={{ backgroundColor: cfg.accentColor }}
              />
              <span className="text-xs font-bold text-text-primary uppercase tracking-wide">
                {cfg.name}
              </span>
            </div>
          </button>
        ))}
      </div>

      {current.config && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-glass-border">
          <div>
            <label className="mono-label block mb-1">Couleur accent</label>
            <input
              type="color"
              value={current.accentColor || current.config.accentColor}
              onChange={(e) =>
                onChange({ ...current, accentColor: e.target.value })
              }
              className="w-full h-8 bg-transparent border border-glass-border cursor-pointer"
            />
          </div>
          <div>
            <label className="mono-label block mb-1">Taille (px)</label>
            <input
              type="number"
              value={current.sizeOverride || current.config.size}
              onChange={(e) =>
                onChange({
                  ...current,
                  sizeOverride: parseInt(e.target.value) || current.config!.size,
                })
              }
              min={20}
              max={150}
              className="glass-input text-xs py-1"
            />
          </div>
          <div>
            <label className="mono-label block mb-1">Mots/ligne</label>
            <input
              type="number"
              value={current.wpl}
              onChange={(e) =>
                onChange({ ...current, wpl: Math.max(1, parseInt(e.target.value) || 3) })
              }
              min={1}
              max={10}
              className="glass-input text-xs py-1"
            />
          </div>
          <div>
            <label className="mono-label block mb-1">Position Y (%)</label>
            <input
              type="number"
              value={current.posY}
              onChange={(e) =>
                onChange({
                  ...current,
                  posY: Math.max(0, Math.min(100, parseInt(e.target.value) || 75)),
                })
              }
              min={0}
              max={100}
              className="glass-input text-xs py-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
