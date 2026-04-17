"use client";

interface StyleSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

const STYLES = [
  {
    id: "hormozi",
    name: "Hormozi",
    desc: "Word highlight, 80px, bold",
    color: "#FFD700",
  },
  {
    id: "cove",
    name: "Cove",
    desc: "Dual-font, accent italic",
    color: "#E85A4F",
  },
  {
    id: "mrbeast",
    name: "MrBeast",
    desc: "Bold pop, 100px, impact",
    color: "#00FF41",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    desc: "Progressive fill, bg pill",
    color: "#FFE600",
  },
  {
    id: "boxed",
    name: "Boxed",
    desc: "Clean pill, fond noir",
    color: "#4A90E2",
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "Lower third, discret",
    color: "#4F46E5",
  },
  {
    id: "neon",
    name: "Neon",
    desc: "Glow cyan/magenta",
    color: "#00FFFF",
  },
];

export default function StyleSelector({
  value,
  onChange,
}: StyleSelectorProps) {
  return (
    <div>
      <label className="mono-label block mb-3">Style sous-titres</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STYLES.map((style) => (
          <button
            key={style.id}
            onClick={() => onChange(style.id)}
            className={`glass-card p-4 text-left transition-all cursor-pointer ${
              value === style.id
                ? "border-purple bg-purple/10 shadow-[0_0_20px_rgba(108,43,217,0.3)]"
                : ""
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-3 h-3"
                style={{ backgroundColor: style.color }}
              />
              <span className="text-sm font-bold text-text-primary uppercase tracking-wide">
                {style.name}
              </span>
            </div>
            <p className="text-xs text-text-muted">{style.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
