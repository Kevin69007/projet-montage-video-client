import type Anthropic from "@anthropic-ai/sdk";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "transcribe_video",
    description:
      "Transcribe a video file using Whisper with word-level timestamps. Returns a JSON array of {word, start, end} objects. Always use this BEFORE cutting — never estimate timestamps.",
    input_schema: {
      type: "object" as const,
      properties: {
        video_path: {
          type: "string",
          description: "Absolute path to the video file",
        },
        language: {
          type: "string",
          description: "Language code (default: fr)",
          default: "fr",
        },
      },
      required: ["video_path"],
    },
  },
  {
    name: "cut_video",
    description:
      "Cut and assemble video segments using FFmpeg concat filter (NEVER concat demuxer). Each segment is defined by start/end timestamps. Applies proper margins: 0.1s before first word, 0.5-0.6s after last word (0.7-1.0s if followed by silence/text frame).",
    input_schema: {
      type: "object" as const,
      properties: {
        input_path: {
          type: "string",
          description: "Path to the source video",
        },
        segments: {
          type: "array",
          description: "Array of {start, end} timestamp pairs in seconds",
          items: {
            type: "object",
            properties: {
              start: { type: "number" },
              end: { type: "number" },
            },
            required: ["start", "end"],
          },
        },
        output_path: {
          type: "string",
          description: "Path for the output video",
        },
      },
      required: ["input_path", "segments", "output_path"],
    },
  },
  {
    name: "burn_subtitles",
    description:
      "Burn styled subtitles onto a video. Supports Hormozi (word-highlight karaoke), Cove (dual-font), and other styles. Requires a transcription JSON file.",
    input_schema: {
      type: "object" as const,
      properties: {
        video_path: {
          type: "string",
          description: "Path to the video file",
        },
        transcription_path: {
          type: "string",
          description:
            "Path to transcription JSON (array of {word, start, end})",
        },
        style: {
          type: "string",
          enum: [
            "hormozi",
            "cove",
            "mrbeast",
            "karaoke",
            "boxed",
            "minimal",
            "neon",
          ],
          description: "Subtitle style preset",
        },
        accent_color: {
          type: "string",
          description:
            "Hex color for accent/highlight (e.g. #3366CC). Extract from video decor at ~3s if not provided.",
        },
        output_path: {
          type: "string",
          description: "Path for the output video",
        },
        font_size: {
          type: "number",
          description: "Font size in pixels (default: 90 for 1080x1920)",
          default: 90,
        },
        words_per_line: {
          type: "number",
          description: "Max words per subtitle line (default: 3)",
          default: 3,
        },
        max_lines: {
          type: "number",
          description: "Max subtitle lines visible at once (default: 2)",
          default: 2,
        },
      },
      required: [
        "video_path",
        "transcription_path",
        "style",
        "accent_color",
        "output_path",
      ],
    },
  },
  {
    name: "generate_text_frame",
    description:
      "Generate an animated text frame video (4s, 1080x1920, black bg). Used for end screens. Has bouncing arrow and CTA. The punchline line is rendered in the accent color.",
    input_schema: {
      type: "object" as const,
      properties: {
        lines: {
          type: "array",
          items: { type: "string" },
          description:
            "Text lines to display (UPPERCASE recommended). Last line is typically the punchline.",
        },
        punchline_index: {
          type: "number",
          description: "0-based index of the punchline line (shown in accent color)",
        },
        output_path: {
          type: "string",
          description: "Path for the output video",
        },
        accent_color: {
          type: "string",
          description: "Hex color for punchline text (default: #EB3223)",
          default: "#EB3223",
        },
        font_size: {
          type: "number",
          description: "Font size in pixels (default: 100)",
          default: 100,
        },
      },
      required: ["lines", "punchline_index", "output_path"],
    },
  },
  {
    name: "concat_videos",
    description:
      "Concatenate multiple videos in sequence using FFmpeg concat filter. Never uses concat demuxer (-f concat) to avoid audio artifacts.",
    input_schema: {
      type: "object" as const,
      properties: {
        video_paths: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of video file paths to concatenate",
        },
        output_path: {
          type: "string",
          description: "Path for the output video",
        },
      },
      required: ["video_paths", "output_path"],
    },
  },
  {
    name: "extract_frame",
    description:
      "Extract a single frame from a video at a given timestamp. Returns the path to the saved image. Useful for color analysis or thumbnail creation.",
    input_schema: {
      type: "object" as const,
      properties: {
        video_path: {
          type: "string",
          description: "Path to the video file",
        },
        timestamp: {
          type: "number",
          description: "Timestamp in seconds to extract the frame from",
        },
        output_path: {
          type: "string",
          description: "Path for the output image (jpg/png)",
        },
      },
      required: ["video_path", "timestamp", "output_path"],
    },
  },
  {
    name: "get_video_info",
    description:
      "Get video metadata: duration, resolution, codec, fps, file size.",
    input_schema: {
      type: "object" as const,
      properties: {
        video_path: {
          type: "string",
          description: "Path to the video file",
        },
      },
      required: ["video_path"],
    },
  },
  {
    name: "remove_silence",
    description:
      "Remove silence gaps from a video. Scans transcription for gaps > threshold between words, then reassembles using concat filter. Preserves tight Reels pacing (max 0.2-0.3s between segments).",
    input_schema: {
      type: "object" as const,
      properties: {
        video_path: {
          type: "string",
          description: "Path to the video file",
        },
        transcription_path: {
          type: "string",
          description: "Path to transcription JSON",
        },
        output_path: {
          type: "string",
          description: "Path for the output video",
        },
        gap_threshold: {
          type: "number",
          description:
            "Minimum gap in seconds to consider as silence (default: 0.5)",
          default: 0.5,
        },
      },
      required: ["video_path", "transcription_path", "output_path"],
    },
  },
  {
    name: "save_output",
    description:
      "Register a processed file as a final output that the user can download. Call this for each deliverable (reel, thumbnail, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the output file",
        },
        label: {
          type: "string",
          description:
            "Display name for this output, e.g. 'Reel 1 - Hook reclamation'",
        },
        description: {
          type: "string",
          description:
            "Optional description text (Instagram caption, YouTube description, etc.)",
        },
      },
      required: ["file_path", "label"],
    },
  },
];
