"use client";

import { useEffect, useRef } from "react";
import SubtitleOverlay from "./SubtitleOverlay";
import type { AppliedSubtitleStyle, TranscriptEntry } from "@/lib/editor/types";

interface VideoPlayerProps {
  videoUrl: string;
  transcription: TranscriptEntry[];
  style: AppliedSubtitleStyle;
  currentTime: number;
  showSubtitles: boolean;
  onTimeUpdate: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

export default function VideoPlayer({
  videoUrl,
  transcription,
  style,
  currentTime,
  showSubtitles,
  onTimeUpdate,
  onDurationChange,
  onPlayingChange,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync external currentTime → video.currentTime when user seeks via timeline
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Math.abs(v.currentTime - currentTime) > 0.3) {
      v.currentTime = currentTime;
    }
  }, [currentTime]);

  return (
    <div className="relative bg-black w-full max-h-[70vh] flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="max-h-[70vh] max-w-full w-auto block"
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => onDurationChange?.(e.currentTarget.duration)}
        onPlay={() => onPlayingChange?.(true)}
        onPause={() => onPlayingChange?.(false)}
      />
      <SubtitleOverlay
        transcription={transcription}
        style={style}
        currentTime={currentTime}
        visible={showSubtitles}
      />
    </div>
  );
}
