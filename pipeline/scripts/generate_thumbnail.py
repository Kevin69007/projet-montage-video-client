#!/usr/bin/env python3
"""Generate YouTube/Instagram thumbnail from a video frame.

Usage:
    python3 generate_thumbnail.py \
        --frame frame.jpg \
        --reference reference.jpg \
        --output thumbnail.jpg \
        --text "MON TITRE" \
        --accent-color "#FF0000" \
        --style match|creative

Produces a 1280x720 JPEG thumbnail.
"""

import argparse
import os
import sys
import random

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

FONTS_DIR = os.environ.get('FONTS_DIR', os.path.join(os.path.dirname(__file__), '..', 'fonts'))


def load_font(name, size):
    """Try to load a font by name from FONTS_DIR."""
    candidates = [
        os.path.join(FONTS_DIR, name),
        os.path.join(FONTS_DIR, f"{name}.ttf"),
        os.path.join(FONTS_DIR, "BigShoulders-Black.ttf"),
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    # Fallback to default
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", size)
    except Exception:
        return ImageFont.load_default()


def analyze_reference(ref_path):
    """Analyze reference image for dominant colors and composition."""
    img = Image.open(ref_path).convert('RGB')
    w, h = img.size

    # Get dominant colors by sampling
    pixels = list(img.resize((50, 50)).getdata())
    avg_r = sum(p[0] for p in pixels) // len(pixels)
    avg_g = sum(p[1] for p in pixels) // len(pixels)
    avg_b = sum(p[2] for p in pixels) // len(pixels)

    # Brightness
    brightness = (avg_r + avg_g + avg_b) / 3

    # Check if text-heavy (lots of high contrast)
    contrast_pixels = sum(1 for p in pixels if max(p) - min(p) > 100)
    has_high_contrast = contrast_pixels > len(pixels) * 0.3

    return {
        'avg_color': (avg_r, avg_g, avg_b),
        'brightness': brightness,
        'has_high_contrast': has_high_contrast,
        'aspect_ratio': w / h,
    }


def compose_thumbnail(frame_path, reference_path, output_path, text='', accent_color='#FF0000', style='match'):
    """Compose a thumbnail from a frame, styled after a reference."""
    TARGET_W, TARGET_H = 1280, 720

    # Load frame
    frame = Image.open(frame_path).convert('RGB')

    # Analyze reference for style hints
    ref_info = {}
    if reference_path and os.path.exists(reference_path):
        ref_info = analyze_reference(reference_path)

    # Parse accent color
    try:
        accent = tuple(int(accent_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        accent = (255, 0, 0)

    # --- Crop and resize frame to 1280x720 ---
    fw, fh = frame.size
    target_ratio = TARGET_W / TARGET_H
    frame_ratio = fw / fh

    if frame_ratio > target_ratio:
        # Frame is wider — crop sides
        new_w = int(fh * target_ratio)
        left = (fw - new_w) // 2
        frame = frame.crop((left, 0, left + new_w, fh))
    else:
        # Frame is taller — crop top/bottom (favor top for faces)
        new_h = int(fw / target_ratio)
        frame = frame.crop((0, 0, fw, new_h))

    frame = frame.resize((TARGET_W, TARGET_H), Image.LANCZOS)

    if style == 'creative':
        # --- Creative style: more saturation, zoom, vignette ---
        # Increase saturation
        enhancer = ImageEnhance.Color(frame)
        frame = enhancer.enhance(1.4)

        # Increase contrast
        enhancer = ImageEnhance.Contrast(frame)
        frame = enhancer.enhance(1.2)

        # Zoom in slightly (crop 10% and resize back)
        margin = int(TARGET_W * 0.05)
        margin_h = int(TARGET_H * 0.05)
        frame = frame.crop((margin, margin_h, TARGET_W - margin, TARGET_H - margin_h))
        frame = frame.resize((TARGET_W, TARGET_H), Image.LANCZOS)

    else:
        # --- Match style: enhance to match reference characteristics ---
        if ref_info.get('has_high_contrast'):
            enhancer = ImageEnhance.Contrast(frame)
            frame = enhancer.enhance(1.3)

        enhancer = ImageEnhance.Color(frame)
        frame = enhancer.enhance(1.2)

    # --- Add vignette ---
    vignette = Image.new('L', (TARGET_W, TARGET_H), 255)
    draw_v = ImageDraw.Draw(vignette)
    for i in range(40):
        opacity = int(255 * (1 - i / 40) * 0.4)
        draw_v.rectangle(
            [i * TARGET_W // 80, i * TARGET_H // 80,
             TARGET_W - i * TARGET_W // 80, TARGET_H - i * TARGET_H // 80],
            fill=255 - opacity
        )
    frame = Image.composite(frame, Image.new('RGB', (TARGET_W, TARGET_H), (0, 0, 0)), vignette)

    draw = ImageDraw.Draw(frame)

    # --- Add accent border at bottom ---
    border_h = 6
    draw.rectangle([0, TARGET_H - border_h, TARGET_W, TARGET_H], fill=accent)

    # --- Add text if provided ---
    if text and text.strip():
        text = text.strip().upper()
        font_size = 72 if len(text) < 20 else 56 if len(text) < 35 else 44
        font = load_font("BigShoulders-Black.ttf", font_size)

        # Text position (center-bottom, above border)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        x = (TARGET_W - text_w) // 2
        y = TARGET_H - text_h - 60

        # Text background (dark semi-transparent box)
        padding = 16
        bg_rect = [x - padding, y - padding, x + text_w + padding, y + text_h + padding]
        bg_img = Image.new('RGBA', (TARGET_W, TARGET_H), (0, 0, 0, 0))
        bg_draw = ImageDraw.Draw(bg_img)
        bg_draw.rectangle(bg_rect, fill=(0, 0, 0, 180))
        frame = Image.alpha_composite(frame.convert('RGBA'), bg_img).convert('RGB')
        draw = ImageDraw.Draw(frame)

        # Text outline
        outline_color = (0, 0, 0)
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                if dx * dx + dy * dy <= 9:
                    draw.text((x + dx, y + dy), text, font=font, fill=outline_color)

        # Text fill (white or accent)
        if style == 'creative':
            draw.text((x, y), text, font=font, fill=accent)
        else:
            draw.text((x, y), text, font=font, fill=(255, 255, 255))

    # --- Save ---
    frame.save(output_path, 'JPEG', quality=95)
    print(f"THUMBNAIL_READY path={output_path}", flush=True)


def main():
    parser = argparse.ArgumentParser(description='Generate thumbnail from video frame')
    parser.add_argument('--frame', required=True, help='Path to extracted video frame')
    parser.add_argument('--reference', default='', help='Path to reference thumbnail image')
    parser.add_argument('--output', required=True, help='Output JPEG path')
    parser.add_argument('--text', default='', help='Text to overlay on thumbnail')
    parser.add_argument('--accent-color', default='#FF0000', help='Accent color hex')
    parser.add_argument('--style', default='match', choices=['match', 'creative'], help='Style: match or creative')
    args = parser.parse_args()

    if not os.path.exists(args.frame):
        print(f"ERROR: Frame not found: {args.frame}", file=sys.stderr)
        sys.exit(1)

    compose_thumbnail(
        frame_path=args.frame,
        reference_path=args.reference,
        output_path=args.output,
        text=args.text,
        accent_color=args.accent_color,
        style=args.style,
    )


if __name__ == '__main__':
    main()
