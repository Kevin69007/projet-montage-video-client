"use client";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function PromptInput({ value, onChange, placeholder }: PromptInputProps) {
  return (
    <div>
      <label className="mono-label block mb-3">Prompt</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Decris ce que tu veux comme montage... Ex: Fais 5 reels a partir de cette video de 8 minutes, avec sous-titres Hormozi et un text frame pour chaque."}
        className="glass-input min-h-[160px] resize-y"
        rows={6}
      />
    </div>
  );
}
