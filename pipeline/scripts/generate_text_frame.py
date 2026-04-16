"""Generate animated text frame video (end screen) for hook videos.

Requires: Pillow (pip install Pillow), ffmpeg-full

Usage:
    python3 generate_text_frame.py "LIGNE1|LIGNE2|PUNCHLINE" PUNCHLINE_INDEX OUTPUT_PATH [ACCENT_COLOR] [FONT_SIZE]

Example:
    python3 generate_text_frame.py "C'EST QUE T'OPTIMISES|UN TRUC QUI EXISTE|MÊME PAS ENCORE." 2 /tmp/text_frame.mp4
    python3 generate_text_frame.py "T'ES ÉPUISÉ|ET FAUCHÉ." 1 /tmp/frame.mp4 "#E63232" 100
"""
import sys
import os
import math
import subprocess
import tempfile
import shutil
from PIL import Image, ImageDraw, ImageFont

FFMPEG = os.environ.get('FFMPEG_PATH', 'ffmpeg')
WIDTH, HEIGHT = 1080, 1920
FPS = 30
DURATION_S = 4
TOTAL_FRAMES = FPS * DURATION_S  # 120

# Font: prefer local (portability), fallback to ~/.claude/fonts/
FONT_LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts', 'BigShoulders-Black.ttf')
FONT_GLOBAL = os.path.expanduser('~/.claude/fonts/BigShoulders-Black.ttf')
FONT_PATH = FONT_LOCAL if os.path.exists(FONT_LOCAL) else FONT_GLOBAL


def generate_frames(lines, punchline_idx, accent_color='#EB3223', font_size=100):
    """Generate PNG frames with bouncing arrow animation.

    Args:
        lines: list of text lines (UPPERCASE recommended)
        punchline_idx: index of the punchline line (displayed in accent color, 0-based)
        accent_color: hex color for punchline (default red)
        font_size: font size in px (95-105 range recommended)

    Returns:
        path to temp directory containing frame_NNNN.png files
    """
    frames_dir = tempfile.mkdtemp(prefix='textframe_')

    font_main = ImageFont.truetype(FONT_PATH, font_size)
    font_punch = ImageFont.truetype(FONT_PATH, font_size + 5)
    font_cta = ImageFont.truetype(FONT_PATH, 52)
    font_arrow = ImageFont.truetype(FONT_PATH, 62)

    # Parse accent color
    r_acc = int(accent_color[1:3], 16)
    g_acc = int(accent_color[3:5], 16)
    b_acc = int(accent_color[5:7], 16)

    for f in range(TOTAL_FRAMES):
        t = f / FPS
        img = Image.new('RGB', (WIDTH, HEIGHT), (0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Fade in (first 0.5s)
        alpha = min(1.0, t / 0.5)

        # Red bar separator
        bar_w, bar_h = 140, 5
        bar_y = HEIGHT // 2 - 60 - len(lines) * 55
        draw.rectangle(
            [(WIDTH - bar_w) // 2, bar_y, (WIDTH + bar_w) // 2, bar_y + bar_h],
            fill=(int(r_acc * alpha), int(g_acc * alpha), int(b_acc * alpha))
        )

        # Text lines
        y = bar_y + 30
        for i, line in enumerate(lines):
            is_punch = (i == punchline_idx)
            font = font_punch if is_punch else font_main
            if is_punch:
                fill = (int(r_acc * alpha), int(g_acc * alpha), int(b_acc * alpha))
            else:
                c = int(255 * alpha)
                fill = (c, c, c)

            bbox = draw.textbbox((0, 0), line, font=font)
            tw = bbox[2] - bbox[0]
            draw.text(((WIDTH - tw) // 2, y), line, font=font, fill=fill)
            y += bbox[3] - bbox[1] + 15

        # CTA "LIS LA DESCRIPTION"
        c = int(255 * alpha)
        cta = "LIS LA DESCRIPTION"
        bbox = draw.textbbox((0, 0), cta, font=font_cta)
        tw = bbox[2] - bbox[0]
        draw.text(((WIDTH - tw) // 2, HEIGHT - 200), cta, font=font_cta, fill=(c, c, c))

        # Bouncing arrow (PIL, not drawtext — unicode issue with ffmpeg)
        arrow = "\u25bc"  # ▼
        bbox = draw.textbbox((0, 0), arrow, font=font_arrow)
        aw = bbox[2] - bbox[0]
        bounce_y = HEIGHT - 145 + int(10 * math.sin(2 * math.pi * t / 0.8))
        draw.text(((WIDTH - aw) // 2, bounce_y), arrow, font=font_arrow, fill=(c, c, c))

        img.save(os.path.join(frames_dir, f'frame_{f:04d}.png'))

    return frames_dir


def frames_to_video(frames_dir, output_path):
    """Convert PNG sequence to 4s video with silent audio track."""
    cmd = [
        FFMPEG, '-y',
        '-framerate', str(FPS),
        '-i', os.path.join(frames_dir, 'frame_%04d.png'),
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', str(DURATION_S),
        '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', '30000/1001',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        '-shortest',
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg error: {result.stderr[-500:]}", file=sys.stderr)
        sys.exit(1)
    return output_path


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    lines_str = sys.argv[1]       # "LIGNE1|LIGNE2|PUNCHLINE"
    punchline_idx = int(sys.argv[2])  # 0-based index
    output_path = sys.argv[3]
    accent_color = sys.argv[4] if len(sys.argv) > 4 else '#EB3223'
    font_size = int(sys.argv[5]) if len(sys.argv) > 5 else 100

    lines = [l.strip().upper() for l in lines_str.split('|')]

    if punchline_idx >= len(lines):
        print(f"Error: punchline_idx {punchline_idx} >= {len(lines)} lines")
        sys.exit(1)

    print(f"Generating {TOTAL_FRAMES} frames...")
    frames_dir = generate_frames(lines, punchline_idx, accent_color, font_size)

    print(f"Converting to video: {output_path}")
    frames_to_video(frames_dir, output_path)

    # Cleanup
    shutil.rmtree(frames_dir, ignore_errors=True)
    print(f"Done: {output_path}")


if __name__ == '__main__':
    main()
