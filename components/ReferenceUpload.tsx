"use client";

import { useRef, useState } from "react";

interface ReferenceUploadProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
}

export default function ReferenceUpload({
  file,
  onFileChange,
}: ReferenceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) return;
    onFileChange(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleRemove = () => {
    onFileChange(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <label className="mono-label block mb-3">Image reference miniature</label>

      {!file ? (
        <div
          className={`upload-zone p-6 text-center cursor-pointer transition-all ${
            dragOver ? "drag-over" : ""
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="text-3xl mb-2 opacity-40">🖼</div>
          <p className="text-sm text-text-muted">
            Glisse une image de reference ici
          </p>
          <p className="text-xs text-text-muted mt-1 opacity-50">
            JPG, PNG — la miniature dont tu veux t&apos;inspirer
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleInputChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="glass-card p-4">
          <div className="flex items-start gap-4">
            {preview && (
              <img
                src={preview}
                alt="Reference"
                className="w-32 h-20 object-cover border border-glass-border"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary truncate">{file.name}</p>
              <p className="text-xs text-text-muted mt-1">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button
              onClick={handleRemove}
              className="text-text-muted hover:text-text-primary text-lg"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
