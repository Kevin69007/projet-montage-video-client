"use client";

interface ControlsProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  onPlayPause: () => void;
  onStep: (deltaSeconds: number) => void;
  onSpeedChange: (speed: number) => void;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export default function Controls({
  playing,
  speed,
  onPlayPause,
  onStep,
  onSpeedChange,
}: ControlsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onStep(-0.5)}
        className="btn-ghost text-xs px-3 py-1.5"
        title="-0.5s"
      >
        -0.5s
      </button>
      <button
        onClick={() => onStep(-0.1)}
        className="btn-ghost text-xs px-3 py-1.5"
        title="-0.1s"
      >
        -0.1s
      </button>
      <button
        onClick={onPlayPause}
        className="btn-primary text-sm px-5 py-2"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <button
        onClick={() => onStep(0.1)}
        className="btn-ghost text-xs px-3 py-1.5"
        title="+0.1s"
      >
        +0.1s
      </button>
      <button
        onClick={() => onStep(0.5)}
        className="btn-ghost text-xs px-3 py-1.5"
        title="+0.5s"
      >
        +0.5s
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="mono-label">Vitesse</span>
        <select
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          className="glass-input text-xs py-1 px-2"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
