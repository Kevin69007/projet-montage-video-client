import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PIPELINE_DIR = path.join(process.cwd(), "pipeline");
const SCRIPTS_DIR = path.join(PIPELINE_DIR, "scripts");
const FONTS_DIR = path.join(PIPELINE_DIR, "fonts");

function exec(cmd: string, timeoutMs = 1800000): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FFMPEG_PATH: process.env.FFMPEG_PATH || "ffmpeg",
        FONTS_DIR: FONTS_DIR,
      },
    }).trim();
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    // If the command produced stdout and exited with code 0-like, it might still be OK
    // But execSync only throws on non-zero exit, so this is a real failure
    const stderr = (error.stderr || "").trim();
    const lastLines = stderr.split("\n").filter(l => !l.includes("MiB/s") && !l.includes("iB/s") && l.trim()).slice(-5).join("\n");
    throw new Error(
      `${lastLines || error.message || "Unknown error"}`
    );
  }
}

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
}

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
  jobDir: string
): Promise<ToolResult> {
  const workDir = path.join(jobDir, "work");
  fs.mkdirSync(workDir, { recursive: true });

  try {
    switch (name) {
      case "transcribe_video":
        return handleTranscribe(input, workDir);
      case "cut_video":
        return handleCutVideo(input);
      case "burn_subtitles":
        return handleBurnSubtitles(input);
      case "generate_text_frame":
        return handleGenerateTextFrame(input);
      case "concat_videos":
        return handleConcatVideos(input);
      case "extract_frame":
        return handleExtractFrame(input);
      case "get_video_info":
        return handleGetVideoInfo(input);
      case "remove_silence":
        return handleRemoveSilence(input);
      case "save_output":
        return handleSaveOutput(input, jobDir);
      default:
        return { success: false, result: "", error: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, result: "", error: error.message };
  }
}

async function handleTranscribe(
  input: Record<string, unknown>,
  workDir: string
): Promise<ToolResult> {
  const videoPath = input.video_path as string;
  const language = (input.language as string) || "fr";
  const outputPath = path.join(workDir, `transcription_${Date.now()}.json`);

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, result: "", error: "OPENAI_API_KEY is not set" };
  }

  // Extract audio (OpenAI API has 25MB limit)
  const audioPath = path.join(workDir, `audio_${Date.now()}.mp3`);
  exec(
    `ffmpeg -y -i "${videoPath}" -vn -ac 1 -ar 16000 -b:a 64k -f mp3 "${audioPath}"`,
    300000
  );

  // Call OpenAI Whisper API
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

  const formData = new FormData();
  formData.append("file", audioBlob, "audio.mp3");
  formData.append("model", "whisper-1");
  formData.append("language", language);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      success: false,
      result: "",
      error: `OpenAI API error ${res.status}: ${errText.slice(0, 300)}`,
    };
  }

  const data = await res.json();

  // Transform to [{word, start, end}] format
  const words = ((data as { words?: { word: string; start: number; end: number }[] }).words || []).map(
    (w: { word: string; start: number; end: number }) => ({
      word: w.word.trim(),
      start: w.start,
      end: w.end,
    })
  );

  fs.writeFileSync(outputPath, JSON.stringify(words, null, 2));

  // Clean up audio file
  try { fs.unlinkSync(audioPath); } catch (_) { /* ignore */ }

  return {
    success: true,
    result: `Transcription saved to ${outputPath}. Found ${words.length} words. First 5: ${JSON.stringify(words.slice(0, 5))}`,
  };
}

function handleCutVideo(input: Record<string, unknown>): ToolResult {
  const inputPath = input.input_path as string;
  const segments = input.segments as { start: number; end: number }[];
  const outputPath = input.output_path as string;

  if (segments.length === 0) {
    return { success: false, result: "", error: "No segments provided" };
  }

  // Build FFmpeg concat filter command
  const inputs = segments
    .map((s, i) => `-ss ${s.start} -to ${s.end} -i "${inputPath}"`)
    .join(" ");

  const filterParts = segments
    .map(
      (_, i) =>
        `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`
    )
    .join(";");

  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  const filterComplex = `${filterParts};${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const cmd = `${ffmpeg} -y ${inputs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${outputPath}"`;

  exec(cmd, 600000);

  return {
    success: true,
    result: `Video cut into ${segments.length} segments and saved to ${outputPath}`,
  };
}

function handleBurnSubtitles(input: Record<string, unknown>): ToolResult {
  const videoPath = input.video_path as string;
  const transcriptionPath = input.transcription_path as string;
  const style = (input.style as string) || "hormozi";
  const accentColor = (input.accent_color as string) || "#6C2BD9";
  const outputPath = input.output_path as string;
  const fontSize = (input.font_size as number) || 90;
  const wpl = (input.words_per_line as number) || 3;
  const maxLines = (input.max_lines as number) || 2;

  let script = "burn_subtitles.py";
  if (style === "cove") {
    script = "burn_subtitles_cove.py";
  }

  const cmd = `python3 "${SCRIPTS_DIR}/${script}" "${videoPath}" "${transcriptionPath}" "${accentColor}" "${outputPath}" ${fontSize} ${wpl} ${maxLines}`;
  exec(cmd, 600000);

  return {
    success: true,
    result: `Subtitles (${style} style, accent ${accentColor}) burned to ${outputPath}`,
  };
}

function handleGenerateTextFrame(input: Record<string, unknown>): ToolResult {
  const lines = input.lines as string[];
  const punchlineIndex = input.punchline_index as number;
  const outputPath = input.output_path as string;
  const accentColor = (input.accent_color as string) || "#EB3223";
  const fontSize = (input.font_size as number) || 100;

  const linesStr = lines.join("|");
  const cmd = `python3 "${SCRIPTS_DIR}/generate_text_frame.py" "${linesStr}" ${punchlineIndex} "${outputPath}" "${accentColor}" ${fontSize}`;
  exec(cmd, 120000);

  return {
    success: true,
    result: `Text frame generated at ${outputPath} with ${lines.length} lines, punchline at index ${punchlineIndex}`,
  };
}

function handleConcatVideos(input: Record<string, unknown>): ToolResult {
  const videoPaths = input.video_paths as string[];
  const outputPath = input.output_path as string;

  if (videoPaths.length === 0) {
    return { success: false, result: "", error: "No videos provided" };
  }

  if (videoPaths.length === 1) {
    fs.copyFileSync(videoPaths[0], outputPath);
    return { success: true, result: `Single video copied to ${outputPath}` };
  }

  // Build concat filter command
  const inputs = videoPaths.map((p) => `-i "${p}"`).join(" ");
  const filterParts = videoPaths
    .map(
      (_, i) =>
        `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`
    )
    .join(";");
  const concatInputs = videoPaths.map((_, i) => `[v${i}][a${i}]`).join("");
  const filterComplex = `${filterParts};${concatInputs}concat=n=${videoPaths.length}:v=1:a=1[outv][outa]`;

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const cmd = `${ffmpeg} -y ${inputs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${outputPath}"`;

  exec(cmd, 600000);

  return {
    success: true,
    result: `${videoPaths.length} videos concatenated to ${outputPath}`,
  };
}

function handleExtractFrame(input: Record<string, unknown>): ToolResult {
  const videoPath = input.video_path as string;
  const timestamp = input.timestamp as number;
  const outputPath = input.output_path as string;

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  exec(
    `${ffmpeg} -y -ss ${timestamp} -i "${videoPath}" -frames:v 1 "${outputPath}"`
  );

  return {
    success: true,
    result: `Frame extracted at ${timestamp}s to ${outputPath}`,
  };
}

function handleGetVideoInfo(input: Record<string, unknown>): ToolResult {
  const videoPath = input.video_path as string;

  const result = exec(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`
  );

  const info = JSON.parse(result);
  const videoStream = info.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "video"
  );
  const audioStream = info.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "audio"
  );

  const summary = {
    duration: parseFloat(info.format?.duration || "0"),
    size_mb: (parseFloat(info.format?.size || "0") / 1024 / 1024).toFixed(1),
    width: videoStream?.width,
    height: videoStream?.height,
    fps: videoStream?.r_frame_rate,
    video_codec: videoStream?.codec_name,
    audio_codec: audioStream?.codec_name,
    audio_sample_rate: audioStream?.sample_rate,
  };

  return {
    success: true,
    result: JSON.stringify(summary, null, 2),
  };
}

function handleRemoveSilence(input: Record<string, unknown>): ToolResult {
  const videoPath = input.video_path as string;
  const transcriptionPath = input.transcription_path as string;
  const outputPath = input.output_path as string;
  const gapThreshold = (input.gap_threshold as number) || 0.5;

  // Read transcription and find speech segments
  const transcription = JSON.parse(
    fs.readFileSync(transcriptionPath, "utf-8")
  );
  const words = transcription.filter(
    (w: { type?: string; word?: string; text?: string }) =>
      (!w.type || w.type === "word") && (w.word || w.text)
  );

  if (words.length === 0) {
    return {
      success: false,
      result: "",
      error: "No words found in transcription",
    };
  }

  // Build segments of continuous speech (merge words with small gaps)
  const segments: { start: number; end: number }[] = [];
  let segStart = words[0].start;
  let segEnd = words[0].end;

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - segEnd;
    if (gap > gapThreshold) {
      // Add margin: 0.1s before, 0.3s after (internal segments)
      segments.push({
        start: Math.max(0, segStart - 0.1),
        end: segEnd + 0.3,
      });
      segStart = words[i].start;
    }
    segEnd = words[i].end;
  }
  // Last segment gets larger margin
  segments.push({
    start: Math.max(0, segStart - 0.1),
    end: segEnd + 0.6,
  });

  if (segments.length <= 1) {
    fs.copyFileSync(videoPath, outputPath);
    return {
      success: true,
      result: `No significant silences found. Video copied to ${outputPath}`,
    };
  }

  // Use concat filter
  const inputs = segments
    .map((s) => `-ss ${s.start} -to ${s.end} -i "${videoPath}"`)
    .join(" ");
  const filterParts = segments
    .map(
      (_, i) =>
        `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`
    )
    .join(";");
  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  const filterComplex = `${filterParts};${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  exec(
    `${ffmpeg} -y ${inputs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -r 30000/1001 -c:a aac -ar 48000 -ac 2 "${outputPath}"`,
    600000
  );

  return {
    success: true,
    result: `Removed ${segments.length - 1} silence gaps. Output: ${outputPath}`,
  };
}

function handleSaveOutput(
  input: Record<string, unknown>,
  jobDir: string
): ToolResult {
  const filePath = input.file_path as string;
  const label = input.label as string;
  const description = (input.description as string) || "";

  const outputDir = path.join(jobDir, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const fileName = path.basename(filePath);
  const destPath = path.join(outputDir, fileName);

  if (filePath !== destPath) {
    fs.copyFileSync(filePath, destPath);
  }

  // Update outputs manifest
  const manifestPath = path.join(jobDir, "outputs.json");
  let outputs: { file: string; label: string; description: string }[] = [];
  if (fs.existsSync(manifestPath)) {
    outputs = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  }
  outputs.push({ file: fileName, label, description });
  fs.writeFileSync(manifestPath, JSON.stringify(outputs, null, 2));

  return {
    success: true,
    result: `Output saved: "${label}" → ${fileName}`,
  };
}
