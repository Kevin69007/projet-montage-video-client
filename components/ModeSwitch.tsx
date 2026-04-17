"use client";

interface ModeSwitchProps {
  value: "video" | "miniature";
  onChange: (value: "video" | "miniature") => void;
}

const MODES = [
  { id: "video" as const, label: "Video", icon: "▶" },
  { id: "miniature" as const, label: "Miniature", icon: "◻" },
];

export default function ModeSwitch({ value, onChange }: ModeSwitchProps) {
  return (
    <div className="flex gap-3">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onChange(mode.id)}
          className={`flex-1 glass-card p-4 text-center transition-all cursor-pointer ${
            value === mode.id
              ? "border-purple bg-purple/10 shadow-[0_0_20px_rgba(108,43,217,0.3)]"
              : ""
          }`}
        >
          <span className="text-2xl block mb-1">{mode.icon}</span>
          <span className="text-sm font-bold text-text-primary uppercase tracking-wide">
            {mode.label}
          </span>
        </button>
      ))}
    </div>
  );
}
