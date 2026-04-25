"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDownloadUrl, getEditorData, renderEditor, saveEditorState } from "@/lib/api";
import type { RenderResult } from "@/lib/api";
import type { AppliedSubtitleStyle, EditorData, EditorState } from "@/lib/editor/types";
import {
  buildInitialState,
  computeSegments,
  useEditorReducer,
} from "@/lib/editor/store";
import VideoPlayer from "@/components/editor/VideoPlayer";
import Timeline from "@/components/editor/Timeline";
import Controls from "@/components/editor/Controls";
import TranscriptPanel from "@/components/editor/TranscriptPanel";
import StyleSwitcher from "@/components/editor/StyleSwitcher";
import MarkersPanel from "@/components/editor/MarkersPanel";
import SegmentsList from "@/components/editor/SegmentsList";

const DEFAULT_STYLE_NAME = "hormozi";
const SAVE_DEBOUNCE_MS = 1500;

function defaultStyle(data: EditorData | null): AppliedSubtitleStyle {
  if (!data) {
    return {
      name: null,
      config: null,
      accentColor: null,
      posY: 75,
      sizeOverride: null,
      wpl: 3,
      lines: 2,
    };
  }
  const styleKey = data.styles[DEFAULT_STYLE_NAME]
    ? DEFAULT_STYLE_NAME
    : Object.keys(data.styles)[0];
  const cfg = data.styles[styleKey];
  return {
    name: styleKey || null,
    config: cfg || null,
    accentColor: cfg?.accentColor || null,
    posY: 75,
    sizeOverride: null,
    wpl: cfg?.wordsPerLine || 3,
    lines: 2,
  };
}

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
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  // Versions produced from this editor session (post-render)
  const [renderedVersions, setRenderedVersions] = useState<RenderResult[]>([]);

  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // Initialize reducer with empty state until data loads
  const initialState = useMemo(
    () => buildInitialState([], defaultStyle(null)),
    []
  );
  const { state, actions } = useEditorReducer(initialState);

  // Load editor data
  useEffect(() => {
    getEditorData(jobId, file)
      .then((d) => {
        setData(d);
        // Initialize reducer state: prefer saved edits, fallback to fresh state
        const fresh: EditorState = d.savedEdits
          ? d.savedEdits
          : buildInitialState(d.transcription, defaultStyle(d));
        actions.init(fresh);
      })
      .catch((e) => setError(e.message || "Erreur de chargement"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, file]);

  // Find <video> DOM element after mount
  useEffect(() => {
    if (!data) return;
    const v = document.querySelector<HTMLVideoElement>(".editor-video video");
    videoElRef.current = v;
  }, [data]);

  useEffect(() => {
    if (videoElRef.current) videoElRef.current.playbackRate = speed;
  }, [speed]);

  const seek = useCallback((t: number) => {
    setCurrentTime(t);
    if (videoElRef.current) videoElRef.current.currentTime = t;
  }, []);

  const handleStep = useCallback((delta: number) => {
    const v = videoElRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    v.currentTime = next;
    setCurrentTime(next);
  }, []);

  const handlePlayPause = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }, []);

  // Auto-save with debounce when state changes (after initial load)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    // Empty transcription = pre-init state, skip
    if (state.transcription.length === 0) return;
    // Same updatedAt as last saved → nothing changed, skip
    if (lastSavedUpdatedAtRef.current === state.updatedAt) return;
    // Skip if this is the initial loaded state (no user edit yet)
    if (!lastSavedUpdatedAtRef.current) {
      lastSavedUpdatedAtRef.current = state.updatedAt;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        setIsSaving(true);
        const res = await saveEditorState(jobId, file, state);
        lastSavedUpdatedAtRef.current = state.updatedAt;
        setSavedAt(res.savedAt);
      } catch (e) {
        console.error("Auto-save failed:", e);
      } finally {
        setIsSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, jobId, file, data]);

  // Render action — applies edits, produces new version, stays in editor
  const handleRender = useCallback(
    async (burnSubtitles: boolean) => {
      setRenderError("");
      setIsRendering(true);
      try {
        // Cancel any pending auto-save (we're saving manually below)
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        // Make sure latest state is saved first
        await saveEditorState(jobId, file, state);
        lastSavedUpdatedAtRef.current = state.updatedAt;
        const result = await renderEditor(jobId, file, state, burnSubtitles);
        // Stay on the editor — append new version to the list
        setRenderedVersions((prev) => [...prev, result]);
        setIsRendering(false);
      } catch (e) {
        const err = e as Error;
        setRenderError(err.message || "Erreur de rendu");
        setIsRendering(false);
      }
    },
    [jobId, file, state]
  );

  // Compute segments from cuts
  const segments = useMemo(
    () => computeSegments(state.cuts, state.deletedSegments, duration),
    [state.cuts, state.deletedSegments, duration]
  );

  // Compute deleted ranges (for timeline visualization)
  const deletedRanges = useMemo(
    () => segments.filter((s) => s.deleted).map((s) => ({ start: s.start, end: s.end })),
    [segments]
  );

  // "Any edits to apply" — used for the "Appliquer coupes" button
  const hasEdits = useMemo(
    () =>
      state.cuts.length > 0 ||
      state.deletedSegments.length > 0 ||
      state.transcription.some((e) => e.deleted) ||
      state.transcription.some((e) => e.type === "silence" && e.trimTo !== null && e.trimTo !== undefined),
    [state.cuts, state.deletedSegments, state.transcription]
  );

  // Refs for latest values — keeps keyboard handler stable across renders
  const currentTimeRef = useRef(currentTime);
  const cutsRef = useRef(state.cuts);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { cutsRef.current = state.cuts; }, [state.cuts]);

  // Keyboard shortcuts — attach ONCE, read current values via refs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = document.activeElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
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
      } else if (e.code === "KeyC") {
        actions.addCut(currentTimeRef.current);
      } else if (e.code === "KeyZ") {
        const latest = cutsRef.current;
        if (latest.length > 0) {
          actions.removeCut(latest[latest.length - 1]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePlayPause, handleStep, actions]);

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

  // Use the actual transcription from state if non-empty, else from data
  const transcription = state.transcription.length > 0 ? state.transcription : data.transcription;

  return (
    <main className="flex-1 flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b border-glass-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="heading-xl text-xl truncate">Editeur — {data.label}</h1>
            <p className="text-xs text-text-muted mt-1 font-mono truncate">{data.file}</p>
          </div>
          <div className="flex items-center gap-3">
            {isSaving && (
              <span className="text-xs text-text-muted font-mono">Sauvegarde...</span>
            )}
            {!isSaving && savedAt && (
              <span className="text-xs text-purple-light font-mono">
                ✓ {new Date(savedAt).toLocaleTimeString("fr-FR")}
              </span>
            )}
            <button
              onClick={() => handleRender(false)}
              disabled={isRendering || !hasEdits}
              className="btn-ghost text-sm disabled:opacity-40"
              title={hasEdits ? "Applique les coupes uniquement, sans sous-titres" : "Aucun changement a appliquer"}
            >
              {isRendering ? "Rendu..." : "Appliquer coupes"}
            </button>
            <button
              onClick={() => handleRender(true)}
              disabled={isRendering || !state.style.config}
              className="btn-primary text-sm disabled:opacity-40"
              title="Applique les coupes + bruler les sous-titres avec le style actuel"
            >
              {isRendering ? "Rendu..." : "Appliquer + sous-titres"}
            </button>
            <button
              onClick={() => router.push(`/job/${jobId}`)}
              className="btn-ghost text-sm"
            >
              ← Retour
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          {/* Left: video + timeline + controls + segments + style */}
          <div className="space-y-4">
            <div className="editor-video">
              <VideoPlayer
                videoUrl={data.videoUrl}
                transcription={transcription}
                style={state.style}
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
              cuts={state.cuts}
              markers={state.markers}
              deletedRanges={deletedRanges}
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
              onAddCut={() => actions.addCut(currentTime)}
              onUndoCut={() => {
                if (state.cuts.length > 0) {
                  actions.removeCut(state.cuts[state.cuts.length - 1]);
                }
              }}
              hasCuts={state.cuts.length > 0}
            />
            <SegmentsList
              segments={segments}
              currentTime={currentTime}
              onToggleDelete={actions.toggleSegmentDeleted}
              onSeek={seek}
            />
            <StyleSwitcher
              styles={data.styles}
              current={state.style}
              showSubtitles={showSubtitles}
              onChange={actions.updateStyle}
              onToggleSubtitles={setShowSubtitles}
            />

            {/* Rendered versions — appears after first render, lets user preview/download produced versions */}
            {renderedVersions.length > 0 && (
              <div className="glass-card p-4 space-y-3 border-purple/30 bg-purple/5">
                <div className="flex items-center justify-between">
                  <div className="mono-label">Versions produites ({renderedVersions.length})</div>
                  <button
                    onClick={() => router.push(`/job/${jobId}`)}
                    className="text-xs text-purple-light hover:text-purple-light/80"
                  >
                    Voir aux resultats →
                  </button>
                </div>
                {renderedVersions.map((v, i) => {
                  const url = getDownloadUrl(jobId, v.videoFile);
                  return (
                    <div key={`${v.videoFile}-${i}`} className="border border-glass-border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-text-primary truncate">
                            v{v.version} {v.subtitlesBurned ? "(avec sous-titres)" : "(sans sous-titres)"}
                          </p>
                          <p className="text-[10px] font-mono text-text-muted truncate">{v.videoFile} · {v.duration.toFixed(1)}s</p>
                        </div>
                        <a
                          href={url}
                          download={v.videoFile}
                          className="btn-ghost text-[10px] py-1 px-2 shrink-0"
                        >
                          Telecharger
                        </a>
                      </div>
                      <video src={url} controls className="w-full max-h-72 object-contain bg-black" preload="metadata" />
                      <p className="text-[10px] text-text-muted italic">
                        Modifie l&apos;edition ci-contre puis clique &laquo;Appliquer&raquo; pour produire une nouvelle version.
                        Utilise le chat IA pour suggerer des changements.
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: transcript + markers */}
          <div className="space-y-4">
            <TranscriptPanel
              transcription={transcription}
              currentTime={currentTime}
              editable
              onSeek={seek}
              onToggleWordDeleted={actions.toggleWordDeleted}
              onToggleSilenceDeleted={actions.toggleSilenceDeleted}
              onTrimSilence={actions.trimSilence}
              onToggleLineBreak={actions.toggleLineBreak}
            />
            <MarkersPanel
              markers={state.markers}
              currentTime={currentTime}
              onAdd={actions.addMarker}
              onRemove={actions.removeMarker}
              onSeek={seek}
            />
            <div className="glass-card p-4 text-xs text-text-muted">
              <div className="mono-label mb-2">Raccourcis</div>
              <ul className="space-y-1">
                <li><span className="font-mono">Espace</span> — play/pause</li>
                <li><span className="font-mono">← →</span> — ±0.1s</li>
                <li><span className="font-mono">↑ ↓</span> — ±0.5s</li>
                <li><span className="font-mono">C</span> — couper ici</li>
                <li><span className="font-mono">Z</span> — annuler dernier cut</li>
              </ul>
              <p className="mt-3 italic opacity-70">
                Les modifications se sauvegardent automatiquement. Clique sur &laquo;Appliquer&raquo; en haut pour produire une nouvelle version.
              </p>
            </div>

            {renderError && (
              <div className="border border-red-500/30 bg-red-500/5 p-3">
                <p className="text-xs text-red-400">{renderError}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
