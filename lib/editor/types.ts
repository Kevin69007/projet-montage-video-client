// Editor data model — shared between API, store, and components.

/** Word entry in the transcription (from Whisper). */
export interface TranscriptWord {
  id: string;            // e.g. "w_0"
  type: "word";
  word: string;
  start: number;         // seconds
  end: number;           // seconds
  deleted?: boolean;     // user-marked for removal
  lineBreak?: boolean;   // user-inserted break for subtitle layout
}

/** Silence entry (gap between words detected by ffmpeg silencedetect). */
export interface TranscriptSilence {
  id: string;            // e.g. "s_0"
  type: "silence";
  start: number;
  end: number;
  duration: number;
  deleted?: boolean;
  trimTo?: number | null; // user-set trim length (seconds)
}

export type TranscriptEntry = TranscriptWord | TranscriptSilence;

/** Subtitle style preset (matches pipeline/styles.json schema). */
export interface SubtitleStyle {
  name: string;
  description?: string;
  font: string;
  weight?: number | string;
  size: number;
  textTransform?: "uppercase" | "lowercase" | "none";
  color: string;
  accentColor: string;
  dimColor?: string;
  outline?: { width: number; color: string } | null;
  shadow?: { x: number; y: number; blur: number; color: string } | null;
  glow?: { color: string; radius: number } | null;
  background?: { color: string; borderRadius: number; padding: string } | null;
  barColor?: string;
  animation?: string;
  position?: string;
  wordsPerLine?: number;
}

/** User-applied subtitle config (merges base style + overrides). */
export interface AppliedSubtitleStyle {
  name: string | null;          // styles.json key (e.g. "hormozi")
  config: SubtitleStyle | null; // resolved config
  accentColor: string | null;   // user override
  posY: number;                 // % from top (0-100)
  sizeOverride: number | null;  // px override (null = use config.size)
  wpl: number;                  // words per line (override)
  lines: number;                // visible lines at once
}

/** Marker / comment placed on the timeline. */
export interface Marker {
  id: string;
  time: number;
  comment: string;
  author: "user" | "claude" | "kimi";
  resolved: boolean;
  createdAt: string; // ISO 8601
}

/** Persisted editor state for a single video file. */
export interface EditorState {
  transcription: TranscriptEntry[];
  cuts: number[];               // timestamps where cuts split the video
  deletedSegments: string[];    // segment IDs marked as deleted
  markers: Marker[];
  style: AppliedSubtitleStyle;
  updatedAt: string;
}

/** Response from GET /api/editor/[id]/[file]/data */
export interface EditorData {
  jobId: string;
  file: string;
  label: string;
  description: string;
  videoUrl: string;
  transcription: TranscriptEntry[];
  styles: Record<string, SubtitleStyle>;
  savedEdits: EditorState | null;
  subtitlesBurned: boolean;
}
