"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UploadZone from "@/components/UploadZone";
import PromptInput from "@/components/PromptInput";
import StyleSelector from "@/components/StyleSelector";
import { uploadFiles, startProcessing } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("hormozi");
  const [accentColor, setAccentColor] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "starting">("idle");
  const [error, setError] = useState("");

  const canSubmit = files.length > 0 && prompt.trim().length > 0 && !loading;

  const formatTotalSize = (files: File[]) => {
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total < 1024 * 1024) return `${(total / 1024).toFixed(0)} KB`;
    if (total < 1024 * 1024 * 1024) return `${(total / 1024 / 1024).toFixed(1)} MB`;
    return `${(total / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError("");

    try {
      setUploadPhase("uploading");
      setUploadProgress(0);

      const { jobId } = await uploadFiles(files, (progress) => {
        setUploadProgress(progress);
      });

      setUploadPhase("starting");
      await startProcessing({
        jobId,
        prompt,
        style,
        accentColor: accentColor || undefined,
      });
      router.push(`/job/${jobId}`);
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || "Une erreur est survenue");
      setLoading(false);
      setUploadPhase("idle");
    }
  };

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-glass-border">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="heading-xl text-2xl sm:text-3xl">Montage Video</h1>
          <p className="text-sm text-text-muted mt-1">
            Upload. Prompt. Montage.
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
        <UploadZone files={files} onFilesChange={setFiles} />
        <PromptInput value={prompt} onChange={setPrompt} />
        <StyleSelector value={style} onChange={setStyle} />

        {/* Accent color (optional) */}
        <div>
          <label className="mono-label block mb-3">
            Couleur accent{" "}
            <span className="opacity-50">(optionnel — auto-detecte sinon)</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={accentColor || "#6C2BD9"}
              onChange={(e) => setAccentColor(e.target.value)}
              className="w-10 h-10 bg-transparent border border-glass-border cursor-pointer"
            />
            <input
              type="text"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#6C2BD9"
              className="glass-input w-40"
            />
            {accentColor && (
              <button
                onClick={() => setAccentColor("")}
                className="text-xs text-text-muted hover:text-text-primary"
              >
                Reset (auto)
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Submit */}
        <div className="pt-4 space-y-3">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary w-full text-lg py-4"
          >
            {uploadPhase === "uploading"
              ? `Upload ${uploadProgress}%`
              : uploadPhase === "starting"
                ? "Demarrage du pipeline..."
                : "Lancer le montage"}
          </button>

          {loading && (
            <div>
              <div className="w-full h-1.5 bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full transition-all duration-300 ease-out"
                  style={{
                    width: uploadPhase === "starting" ? "100%" : `${uploadProgress}%`,
                    background: "linear-gradient(90deg, #6C2BD9, #C67651)",
                  }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="mono-label">
                  {uploadPhase === "uploading"
                    ? `${formatTotalSize(files)} — ${uploadProgress}%`
                    : "Connexion au pipeline..."}
                </span>
                {uploadPhase === "uploading" && uploadProgress < 100 && (
                  <span className="mono-label">
                    {files.length} fichier{files.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
