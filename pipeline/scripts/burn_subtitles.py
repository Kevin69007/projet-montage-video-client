"""Generate ASS subtitles with word-level highlighting (Hormozi style) and burn into video."""
import json
import subprocess
import sys
import os

def rgb_to_ass(hex_color):
    """Convert #RRGGBB to ASS &HBBGGRR& format."""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}&"

def generate_ass(words, accent_hex, font_size=54, wpl=3, lines=2, font="Big Shoulders Display"):
    """Generate ASS subtitle content with word-level karaoke highlighting."""
    accent = rgb_to_ass(accent_hex)
    white = "&H00FFFFFF&"
    outline_color = "&H00000000&"

    header = f"""[Script Info]
Title: Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{font_size},{white},&H000000FF&,{outline_color},&H80000000&,-1,0,0,0,100,100,2,0,1,5,2,2,40,40,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    block_size = wpl * lines

    # Smart block builder: respect phrase boundaries (punctuation + silences)
    blocks = []
    current = []
    for i, w in enumerate(words):
        current.append(w)
        word_text = (w.get('word') or w.get('text', '')).strip()

        # Detect sentence end (punctuation)
        is_sentence_end = word_text and word_text[-1] in '.?!'

        # Detect significant silence before next word (>0.3s = segment change)
        has_gap = False
        if i + 1 < len(words):
            gap = words[i+1]['start'] - w['end']
            has_gap = gap > 0.3

        is_last = (i == len(words) - 1)

        # Close block when:
        # - Hit max size (block_size)
        # - Sentence end AND block has at least wpl words (avoid tiny blocks)
        # - Sentence end + significant gap (strong boundary = always cut, even small blocks)
        # - Large gap alone AND block has at least wpl words
        # - Last word
        strong_boundary = is_sentence_end and has_gap  # e.g. "rien." + 0.8s gap
        if is_last or len(current) >= block_size or \
           strong_boundary or \
           ((is_sentence_end or has_gap) and len(current) >= wpl):
            blocks.append(current)
            current = []

    if current:
        blocks.append(current)

    for block in blocks:
        # For each word in the block, create an event showing all words
        # with the active word highlighted
        for active_idx, active_word in enumerate(block):
            start = format_time(active_word['start'])
            end = format_time(active_word['end'])

            # Build text with line breaks every wpl words
            parts = []
            for j, w in enumerate(block):
                word_text = (w.get('word') or w.get('text', '')).upper()
                if j == active_idx:
                    # Active word: accent color + slightly larger
                    parts.append(f"{{\\c{accent}\\fscx110\\fscy110}}{word_text}{{\\c{white}\\fscx100\\fscy100}}")
                else:
                    parts.append(word_text)

                # Add line break every wpl words (except at the end)
                if (j + 1) % wpl == 0 and j + 1 < len(block):
                    parts.append("\\N")
                else:
                    parts.append(" ")

            text = "".join(parts).strip()
            events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

        # Also show the block between words (gaps)
        for i in range(len(block) - 1):
            gap_start = block[i]['end']
            gap_end = block[i+1]['start']
            if gap_end - gap_start > 0.05:
                start = format_time(gap_start)
                end = format_time(gap_end)
                # Show block with no highlight
                parts = []
                for j, w in enumerate(block):
                    parts.append((w.get('word') or w.get('text', '')).upper())
                    if (j + 1) % wpl == 0 and j + 1 < len(block):
                        parts.append("\\N")
                    else:
                        parts.append(" ")
                text = "".join(parts).strip()
                events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

    return header + "\n".join(events) + "\n"

def format_time(seconds):
    """Format seconds to ASS time format H:MM:SS.CC"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

def burn_subtitles(video_path, ass_path, output_path):
    """Burn ASS subtitles into video using FFmpeg."""
    # Prefer local fonts/ (portability), fallback to ~/.claude/fonts/
    local_fonts = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
    fonts_dir = local_fonts if os.path.isdir(local_fonts) else os.path.expanduser('~/.claude/fonts')
    escaped_ass = ass_path.replace(":", "\\:").replace("'", "\\'")
    escaped_fonts = fonts_dir.replace(":", "\\:").replace("'", "\\'")
    vf = f"ass={escaped_ass}:fontsdir={escaped_fonts}"
    cmd = [
        os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-y',
        '-i', video_path,
        '-vf', vf,
        '-c:v', 'libx264', '-crf', '18', '-r', '30000/1001',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg error: {result.stderr[-500:]}", file=sys.stderr)
        sys.exit(1)
    return output_path

if __name__ == '__main__':
    # Args: video_path transcription_json accent_hex output_path [font_size] [wpl] [lines]
    video_path = sys.argv[1]
    trans_path = sys.argv[2]
    accent_hex = sys.argv[3]
    output_path = sys.argv[4]
    font_size = int(sys.argv[5]) if len(sys.argv) > 5 else 54
    wpl = int(sys.argv[6]) if len(sys.argv) > 6 else 3
    lines_count = int(sys.argv[7]) if len(sys.argv) > 7 else 2

    with open(trans_path, 'r') as f:
        words = json.load(f)

    ass_content = generate_ass(words, accent_hex, font_size, wpl, lines_count)
    ass_path = output_path.rsplit('.', 1)[0] + '.ass'
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(ass_content)
    print(f"ASS generated: {ass_path}")

    burn_subtitles(video_path, ass_path, output_path)
    print(f"Subtitled video: {output_path}")
