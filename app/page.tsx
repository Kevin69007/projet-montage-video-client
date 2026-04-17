"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ModeSwitch from "@/components/ModeSwitch";
import UploadZone from "@/components/UploadZone";
import ReferenceUpload from "@/components/ReferenceUpload";
import PromptInput from "@/components/PromptInput";
import StyleSelector from "@/components/StyleSelector";
import { uploadFiles, startProcessing } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  // Mode
  const [mode, setMode] = useState<"video" | "miniature">("video");

  // Shared
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "starting">("idle");
  const [error, setError] = useState("");

  // Video mode
  const [style, setStyle] = useState("hormozi");
  const [videoType, setVideoType] = useState("teaser");
  const [duration, setDuration] = useState(30);
  const [format, setFormat] = useState("9:16");
  const [language, setLanguage] = useState("fr");

  // Miniature mode
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [thumbnailCount, setThumbnailCount] = useState(2);
  const [thumbnailText, setThumbnailText] = useState("");

  const canSubmit =
    files.length > 0 &&
    prompt.trim().length > 0 &&
    !loading &&
    (mode === "video" || referenceImage !== null);

  const formatTotalSize = (fileList: File[]) => {
    const total = fileList.reduce((sum, f) => sum + f.size, 0);
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

      // Upload video files + reference image (if miniature mode)
      const allFiles = mode === "miniature" && referenceImage
        ? [...files, referenceImage]
        : files;

      const { jobId } = await uploadFiles(allFiles, (progress) => {
        setUploadProgress(progress);
      });

      setUploadPhase("starting");
      await startProcessing({
        jobId,
        prompt,
        mode,
        accentColor: accentColor || undefined,
        // Video params
        style,
        videoType,
        duration,
        format,
        language,
        // Miniature params
        thumbnailCount,
        thumbnailText: thumbnailText || undefined,
        referenceFileName: referenceImage?.name,
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
            Upload. Prompt. {mode === "video" ? "Montage." : "Miniature."}
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Mode switch */}
        <ModeSwitch value={mode} onChange={setMode} />

        {/* Upload zone */}
        <UploadZone files={files} onFilesChange={setFiles} />

        {/* --- VIDEO MODE --- */}
        {mode === "video" && (
          <>
            <PromptInput value={prompt} onChange={setPrompt} />
            <StyleSelector value={style} onChange={setStyle} />

            {/* Video type, duration, format, language */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="mono-label block mb-2">Type</label>
                <select
                  value={videoType}
                  onChange={(e) => setVideoType(e.target.value)}
                  className="glass-input w-full"
                >
                  <option value="teaser">Teaser / Reel</option>
                  <option value="clean">Version longue</option>
                  <option value="multi">Multi-reels</option>
                </select>
              </div>

              {videoType === "teaser" && (
                <div>
                  <label className="mono-label block mb-2">Duree (s)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Math.max(5, Math.min(300, parseInt(e.target.value) || 30)))}
                    min={5}
                    max={300}
                    className="glass-input w-full"
                  />
                </div>
              )}

              <div>
                <label className="mono-label block mb-2">Format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="glass-input w-full"
                >
                  <option value="9:16">9:16 Vertical</option>
                  <option value="16:9">16:9 Horizontal</option>
                  <option value="1:1">1:1 Carre</option>
                  <option value="original">Original</option>
                </select>
              </div>

              <div>
                <label className="mono-label block mb-2">Langue</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="glass-input w-full"
                >
                  <option value="fr">Francais</option>
                  <option value="en">English</option>
                  <option value="auto">Auto-detect</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* --- MINIATURE MODE --- */}
        {mode === "miniature" && (
          <>
            <ReferenceUpload file={referenceImage} onFileChange={setReferenceImage} />

            <PromptInput
              value={prompt}
              onChange={setPrompt}
              placeholder="Decris le style de miniature souhaite... Ex: Miniature YouTube avec texte gros, fond flou, visage expressif"
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mono-label block mb-2">Texte miniature</label>
                <input
                  type="text"
                  value={thumbnailText}
                  onChange={(e) => setThumbnailText(e.target.value)}
                  placeholder="MON TITRE (optionnel)"
                  className="glass-input w-full"
                />
              </div>

              <div>
                <label className="mono-label block mb-2">Nombre de miniatures</label>
                <input
                  type="number"
                  value={thumbnailCount}
                  onChange={(e) => setThumbnailCount(Math.max(1, Math.min(6, parseInt(e.target.value) || 2)))}
                  min={1}
                  max={6}
                  className="glass-input w-full"
                />
              </div>
            </div>
          </>
        )}

        {/* Accent color (both modes) */}
        <div>
          <label className="mono-label block mb-3">
            Couleur accent{" "}
            <span className="opacity-50">(optionnel)</span>
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
                Reset
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
                : mode === "video"
                  ? "Lancer le montage"
                  : "Generer les miniatures"}
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
