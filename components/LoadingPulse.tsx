/**
 * Branded loading indicator: 5 vertical bars pulsing with the purple→orange
 * gradient. Use inline anywhere a generic spinner would appear.
 */

interface LoadingPulseProps {
  label?: string;
  className?: string;
}

export default function LoadingPulse({ label, className = "" }: LoadingPulseProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="loading-pulse" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {label && (
        <p className="mono-label text-purple-light/80">{label}</p>
      )}
    </div>
  );
}
