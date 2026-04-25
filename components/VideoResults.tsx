"use client";

import { getDownloadUrl, quickReworkVideo, type JobOutput } from "@/lib/api";
import { useState } from "react";
import LoadingPulse from "@/components/LoadingPulse";

interface VideoResultsProps {
  jobId: string;
  outputs: JobOutput[];
  message: string;
}

export default function VideoResults({
  jobId,
  outputs,
  message,
}: VideoResultsProps) {
  const hasEditable = outputs.some((o) => !o.subtitlesBurned && o.transcription);
  return (
    <div className="space-y-6">
      {/* Summary message */}
      {message && (
        <div className="glass-card p-4">
          <p className="text-sm text-text-body whitespace-pre-wrap">
            {message}
          </p>
        </div>
      )}

      {/* Editor hint banner */}
      {hasEditable && (
        <div className="glass-card p-4 border-purple/30 bg-purple/5">
          <p className="text-sm text-text-body">
            <strong className="text-purple-light">Astuce</strong> — chaque video a son propre champ <strong>Ameliorer avec Kimi</strong> en bas. Decris ton changement (plus court, format 1:1, sous-titres plus gros...) et une nouvelle version apparait. Pour un controle precis, ouvre l&apos;<strong>Editeur</strong>.
          </p>
        </div>
      )}

      {/* Output videos */}
      {outputs.map((output, i) => (
        <OutputCard key={`${output.file}-${i}`} jobId={jobId} output={output} index={i} />
      ))}

      {outputs.length === 0 && (
        <p className="text-text-muted text-sm">Aucun fichier de sortie.</p>
      )}
    </div>
  );
}

function OutputCard({
  jobId,
  output,
  index,
}: {
  jobId: string;
  output: JobOutput;
  index: number;
}) {
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"idle" | "thinking" | "rendering">("idle");
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [done, setDone] = useState<{ file: string; version: number } | null>(null);

  const url = getDownloadUrl(jobId, output.file);
  const isVideo = /\.(mp4|mov|webm)$/i.test(output.file);
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(output.file);
  // Editer button: only on non-burned videos (the full editor expects a clean source).
  const editorAvailable = isVideo && !output.subtitlesBurned && !!output.transcription;
  // Inline rework: any video with a transcription. The endpoint resolves the
  // raw source via sourceFile lookup, so even burned versions can be reworked.
  const reworkAvailable = isVideo && !!output.transcription;
  const editorUrl = editorAvailable
    ? `/job/${jobId}/editor/${encodeURIComponent(output.file)}`
    : null;

  const copyDescription = () => {
    navigator.clipboard.writeText(output.description);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If the user mentions a duration in seconds, the endpoint may switch to
  // extension mode (re-transcribes the original input — slow on first call).
  const extensionLikely = /\b(\d{1,3})\s*(?:s(?:ec(?:ondes?)?)?)\b|\b(plus long|rallong|allong|etire|etend|prolong|garde plus)\b/i.test(prompt);

  const submitRework = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError("");
    setReply("");
    setDone(null);
    setPhase("thinking");
    try {
      // Phase shift after ~6s — Kimi-thinking → render is the longer phase.
      const phaseTimer = setTimeout(() => setPhase("rendering"), 6000);
      const result = await quickReworkVideo(jobId, output.file, trimmed);
      clearTimeout(phaseTimer);
      setReply(result.reply);
      setDone({ file: result.videoFile, version: result.version });
      setPrompt("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPending(false);
      setPhase("idle");
    }
  };

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-purple-light">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-sm font-bold text-text-primary uppercase tracking-wide">
            {output.label}
          </span>
        </div>
        <div className="flex gap-2">
          {editorUrl && (
            <a
              href={editorUrl}
              className="btn-ghost text-xs py-1.5 px-3"
            >
              Editer
            </a>
          )}
          <a
            href={url}
            download={output.file}
            className="btn-primary text-xs py-1.5 px-3"
          >
            Telecharger
          </a>
        </div>
      </div>

      {/* Video player */}
      {isVideo && (
        <div className="bg-black flex items-center justify-center">
          <video
            src={url}
            controls
            className="max-h-[80vh] max-w-full w-auto mx-auto block"
            preload="metadata"
          />
        </div>
      )}

      {/* Image preview */}
      {isImage && (
        <div className="bg-black p-4">
          <img
            src={url}
            alt={output.label}
            className="w-full max-h-[500px] object-contain mx-auto"
          />
        </div>
      )}

      {/* Description */}
      {output.description && (
        <div className="p-4 border-t border-glass-border">
          <div className="flex items-center justify-between mb-2">
            <span className="mono-label">Description</span>
            <button
              onClick={copyDescription}
              className="text-xs text-text-muted hover:text-purple-light transition-colors"
            >
              {copied ? "Copie !" : "Copier"}
            </button>
          </div>
          <pre className="text-xs text-text-body whitespace-pre-wrap font-sans leading-relaxed">
            {output.description}
          </pre>
        </div>
      )}

      {/* Inline rework prompt */}
      {reworkAvailable && (
        <div className="p-4 border-t border-glass-border bg-purple/5">
          <div className="flex items-center justify-between mb-3">
            <span className="mono-label">Ameliorer avec Kimi</span>
            <span className="mono-label text-purple-light/60">~30-60s</span>
          </div>

          {pending ? (
            <div className="space-y-3">
              <LoadingPulse
                label={
                  phase === "rendering"
                    ? "Rendu en cours — concat ffmpeg + sous-titres burned..."
                    : extensionLikely
                      ? "Mode extension — transcription complete + Kimi (peut prendre 2-5 min)..."
                      : "Kimi analyse ta demande et planifie les modifications..."
                }
              />
            </div>
          ) : (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitRework();
                  }
                }}
                placeholder="Ex: fais le plus court, passe en 1:1, sous-titres plus gros, garde juste la punchline..."
                rows={2}
                className="glass-input text-sm resize-none"
                disabled={pending}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="mono-label text-text-muted/60">
                  {extensionLikely ? "Mode extension actif (transcription complete)" : "Cmd/Ctrl + Entree"}
                </span>
                <button
                  onClick={submitRework}
                  disabled={!prompt.trim() || pending}
                  className="btn-primary text-xs py-1.5 px-4"
                >
                  Reformuler →
                </button>
              </div>
            </>
          )}

          {/* Kimi reply */}
          {reply && !pending && (
            <div className="mt-3 p-3 border border-purple/30 bg-purple/10">
              <div className="mono-label text-purple-light mb-1">Reponse Kimi</div>
              <p className="text-xs text-text-body leading-relaxed">{reply}</p>
            </div>
          )}

          {/* Success notice */}
          {done && !pending && (
            <div className="mt-3 p-3 border border-orange/40 bg-orange/10">
              <div className="mono-label text-orange-light mb-1">Nouvelle version produite</div>
              <p className="text-xs text-text-body">
                <strong>{done.file}</strong> — v{done.version}. Elle apparait ci-dessous des que la liste se rafraichit.
              </p>
            </div>
          )}

          {/* Error */}
          {error && !pending && (
            <div className="mt-3 p-3 border border-red-500/40 bg-red-500/10">
              <div className="mono-label text-red-400 mb-1">Erreur</div>
              <p className="text-xs text-text-body">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
