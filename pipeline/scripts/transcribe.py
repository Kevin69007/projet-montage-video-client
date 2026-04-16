#!/usr/bin/env python3
"""Transcribe video to word-level JSON with silence detection.

Usage:
    python3 transcribe.py --video /path/to/video.mp4 --output /tmp/transcription.json

Produces a JSON array of words and silences:
    [
      {"id": "w_0", "type": "word", "word": "Bonjour", "start": 0.0, "end": 0.42},
      {"id": "s_0", "type": "silence", "start": 0.42, "end": 0.92, "duration": 0.5},
      ...
    ]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

import shutil as _shutil
FFMPEG = _shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'


def extract_audio(video_path, output_wav):
    """Extract mono 16kHz WAV from video."""
    cmd = [
        FFMPEG, '-y', '-i', video_path,
        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
        output_wav
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def transcribe_words(audio_path, language='fr'):
    """Run Whisper and return word-level timestamps."""
    try:
        import whisper
    except ImportError:
        print("ERROR: openai-whisper not installed. Run: pip3 install openai-whisper", file=sys.stderr)
        sys.exit(1)
    model = whisper.load_model('small')
    result = model.transcribe(audio_path, language=language, word_timestamps=True)

    words = []
    for seg in result['segments']:
        for w in seg.get('words', []):
            words.append({
                'word': w['word'].strip(),
                'start': round(w['start'], 3),
                'end': round(w['end'], 3)
            })
    return words


def detect_silences(video_path, noise_db=-30, min_duration=0.3):
    """Run FFmpeg silencedetect and return silence ranges."""
    cmd = [
        FFMPEG, '-i', video_path,
        '-af', f'silencedetect=noise={noise_db}dB:d={min_duration}',
        '-f', 'null', '-'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    stderr = result.stderr

    silences = []
    starts = re.findall(r'silence_start: ([\d.]+)', stderr)
    ends = re.findall(r'silence_end: ([\d.]+)', stderr)

    for s, e in zip(starts, ends):
        start = round(float(s), 3)
        end = round(float(e), 3)
        duration = round(end - start, 3)
        silences.append({
            'start': start,
            'end': end,
            'duration': duration
        })
    return silences


def merge_words_and_silences(words, silences):
    """Merge words and silences into a single chronological stream."""
    items = []

    # Add words
    for i, w in enumerate(words):
        items.append({
            'id': f'w_{i}',
            'type': 'word',
            'word': w['word'],
            'start': w['start'],
            'end': w['end'],
            'deleted': False
        })

    # Add silences that don't overlap with words
    for i, s in enumerate(silences):
        # Check if this silence overlaps with any word
        overlaps = False
        for w in words:
            # Silence overlaps if it's not entirely before or after the word
            if s['start'] < w['end'] and s['end'] > w['start']:
                overlaps = True
                break
        if not overlaps:
            items.append({
                'id': f's_{i}',
                'type': 'silence',
                'start': s['start'],
                'end': s['end'],
                'duration': s['duration'],
                'deleted': False,
                'trimTo': None
            })

    # Sort by start time
    items.sort(key=lambda x: x['start'])
    return items


def main():
    parser = argparse.ArgumentParser(description='Transcribe video with word-level timestamps + silence detection')
    parser.add_argument('--video', required=True, help='Path to video file')
    parser.add_argument('--output', required=True, help='Output JSON path')
    parser.add_argument('--language', default='fr', help='Language code (default: fr)')
    parser.add_argument('--silence-noise', type=int, default=-30, help='Silence noise threshold in dB (default: -30)')
    parser.add_argument('--silence-duration', type=float, default=0.3, help='Min silence duration in seconds (default: 0.3)')
    args = parser.parse_args()

    video_path = os.path.abspath(args.video)
    if not os.path.exists(video_path):
        print(f"ERROR: Video not found: {video_path}", file=sys.stderr)
        sys.exit(1)

    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wav_path = tmp.name

    try:
        print("1/3 Extracting audio...", flush=True)
        extract_audio(video_path, wav_path)

        print("2/3 Transcribing words (Whisper)...", flush=True)
        words = transcribe_words(wav_path, args.language)
        print(f"     {len(words)} words found", flush=True)

        print("3/3 Detecting silences (FFmpeg)...", flush=True)
        silences = detect_silences(video_path, args.silence_noise, args.silence_duration)
        print(f"     {len(silences)} silences found", flush=True)

        print("Merging...", flush=True)
        merged = merge_words_and_silences(words, silences)
        print(f"     {len(merged)} items total ({len([x for x in merged if x['type']=='word'])} words, {len([x for x in merged if x['type']=='silence'])} silences)", flush=True)

        output_path = os.path.abspath(args.output)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)

        print(f"TRANSCRIPTION_READY path={output_path}", flush=True)

    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == '__main__':
    main()
