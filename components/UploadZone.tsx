"use client";

import { useCallback, useState, useRef } from "react";

interface UploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
}

export default function UploadZone({ files, onFilesChange }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (newFiles: FileList | null) => {
      if (!newFiles) return;
      const videoFiles = Array.from(newFiles).filter((f) =>
        f.type.startsWith("video/")
      );
      onFilesChange([...files, ...videoFiles]);
    },
    [files, onFilesChange]
  );

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div>
      <label className="mono-label block mb-3">Videos</label>
      <div
        className={`upload-zone p-8 text-center cursor-pointer transition-all ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="text-text-muted">
          <svg
            className="w-10 h-10 mx-auto mb-3 opacity-40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="square"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-sm">
            Glisse tes videos ici ou{" "}
            <span className="text-purple-light underline">parcourir</span>
          </p>
          <p className="text-xs mt-1 opacity-50">MP4, MOV, WebM</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center justify-between glass-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-purple-light font-mono text-sm">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm text-text-primary">{file.name}</p>
                  <p className="text-xs text-text-muted">
                    {formatSize(file.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="text-text-muted hover:text-red-400 transition-colors text-sm"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
