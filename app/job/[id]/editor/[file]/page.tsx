"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getEditorData } from "@/lib/api";
import type { AppliedSubtitleStyle, EditorData } from "@/lib/editor/types";
import VideoPlayer from "@/components/editor/VideoPlayer";
import Timeline from "@/components/editor/Timeline";
import Controls from "@/components/editor/Controls";
import TranscriptPanel from "@/components/editor/TranscriptPanel";
import StyleSwitcher from "@/components/editor/StyleSwitcher";

const DEFAULT_STYLE_NAME = "hormozi";

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;
  const file = decodeURIComponent(params.file as string);

  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [style, setStyle] = useState<AppliedSubtitleStyle>({
    name: null,
    config: null,
    accentColor: null,
    posY: 75,
    sizeOverride: null,
    wpl: 3,
    lines: 2,
  });

  // Imperative control of <video> element
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // Load editor data
  useEffect(() => {
    getEditorData(jobId, file)
      .then((d) => {
        setData(d);
        // Initialize style with default selection (hormozi)
        const styleKey = d.styles[DEFAULT_STYLE_NAME] ? DEFAULT_STYLE_NAME : Object.keys(d.styles)[0];
        if (styleKey && d.styles[styleKey]) {
          const cfg = d.styles[styleKey];
          setStyle({
            name: styleKey,
            config: cfg,
            accentColor: cfg.accentColor,
            posY: 75,
            sizeOverride: null,
            wpl: cfg.wordsPerLine || 3,
            lines: 2,
          });
        }
      })
      .catch((e) => setError(e.message || "Erreur de chargement"));
  }, [jobId, file]);

  // Find the actual <video> DOM element after mount (for imperative control)
  useEffect(() => {
    if (!data) return;
    const v = document.querySelector<HTMLVideoElement>(".editor-video video");
    videoElRef.current = v;
  }, [data]);

  // Speed control
  useEffect(() => {
    if (videoElRef.current) videoElRef.current.playbackRate = speed;
  }, [speed]);

  const seek = useCallback((t: number) => {
    setCurrentTime(t);
    if (videoElRef.current) videoElRef.current.currentTime = t;
  }, []);

  const handleStep = useCallback(
    (delta: number) => {
      const v = videoElRef.current;
      if (!v) return;
      const next = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
      v.currentTime = next;
      setCurrentTime(next);
    },
    []
  );

  const handlePlayPause = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handlePlayPause();
      } else if (e.code === "ArrowLeft") {
        handleStep(-0.1);
      } else if (e.code === "ArrowRight") {
        handleStep(0.1);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        handleStep(0.5);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        handleStep(-0.5);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePlayPause, handleStep]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="border border-red-500/30 bg-red-500/5 p-6 max-w-md">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => router.push(`/job/${jobId}`)}
            className="btn-ghost mt-4 text-sm"
          >
            Retour aux resultats
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-2 border-purple border-t-transparent animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b border-glass-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="heading-xl text-xl">Editeur — {data.label}</h1>
            <p className="text-xs text-text-muted mt-1 font-mono">{data.file}</p>
          </div>
          <button
            onClick={() => router.push(`/job/${jobId}`)}
            className="btn-ghost text-sm"
          >
            ← Retour
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          {/* Left: video + timeline + controls + style */}
          <div className="space-y-4">
            <div className="editor-video">
              <VideoPlayer
                videoUrl={data.videoUrl}
                transcription={data.transcription}
                style={style}
                currentTime={currentTime}
                showSubtitles={showSubtitles}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onPlayingChange={setPlaying}
              />
            </div>
            <Timeline
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
            />
            <Controls
              playing={playing}
              currentTime={currentTime}
              duration={duration}
              speed={speed}
              onPlayPause={handlePlayPause}
              onStep={handleStep}
              onSpeedChange={setSpeed}
            />
            <StyleSwitcher
              styles={data.styles}
              current={style}
              showSubtitles={showSubtitles}
              onChange={setStyle}
              onToggleSubtitles={setShowSubtitles}
            />
          </div>

          {/* Right: transcript */}
          <div className="space-y-4">
            <TranscriptPanel
              transcription={data.transcription}
              currentTime={currentTime}
              onSeek={seek}
            />
            <div className="glass-card p-4 text-xs text-text-muted">
              <div className="mono-label mb-2">Raccourcis</div>
              <ul className="space-y-1">
                <li><span className="font-mono">Espace</span> — play/pause</li>
                <li><span className="font-mono">← →</span> — ±0.1s</li>
                <li><span className="font-mono">↑ ↓</span> — ±0.5s</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Phase 2 placeholder */}
        <div className="mt-8 glass-card p-4 border-purple/30 bg-purple/5">
          <p className="text-sm text-text-body">
            <strong className="text-purple-light">Phase 2</strong> — Editeur en lecture seule. Phase 3 ajoutera : edition de la transcription, decoupe, marqueurs, sauvegarde des modifications.
          </p>
        </div>
      </div>
    </main>
  );
}
