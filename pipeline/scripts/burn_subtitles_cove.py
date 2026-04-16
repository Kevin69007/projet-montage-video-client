"""
Cove-style subtitles: Instrument Sans Bold + Playfair Display Italic for accent words.
Auto-detects emotionally strong words for accent highlighting.
"""
import json
import subprocess
import sys
import os
import re

# Words that are typically emotionally strong / hook-worthy in French
ACCENT_PATTERNS = {
    # Pronouns that create personal connection
    "tu", "toi", "tienne", "tien", "tiennes", "tiens",
    "vous", "votre", "vos",
    # Emotional / strong nouns
    "vie", "mort", "peur", "reve", "reves", "argent", "liberte", "succes",
    "echec", "erreur", "verite", "mensonge", "passion", "pouvoir", "courage",
    "confiance", "amour", "haine", "force", "faiblesse", "chance", "risque",
    "temps", "avenir", "destin", "secret", "probleme", "solution",
    "victoire", "defaite", "limite", "potentiel", "impact", "choix",
    # Strong adjectives
    "impossible", "incroyable", "extraordinaire", "terrible", "enorme",
    "seul", "seule", "vrai", "vraie", "faux", "fausse", "fou", "folle",
    "libre", "riche", "pauvre", "fort", "forte", "faible",
    # Strong verbs
    "detruire", "creer", "oser", "gagner", "perdre", "abandonner",
    "reussir", "echouer", "changer", "dominer", "exploser", "arreter",
    "mourir", "vivre", "survivre", "combattre",
    # Intensifiers / negation
    "jamais", "toujours", "rien", "tout", "personne", "aucun", "aucune",
    "trop", "plus", "moins", "mieux", "pire",
    # Numbers that punch
    "zero", "million", "millions", "milliard",
}


def normalize(word):
    """Remove accents and lowercase for matching."""
    import unicodedata
    nfkd = unicodedata.normalize('NFKD', word.lower())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def is_accent_word(word):
    """Detect if a word should be highlighted."""
    clean = normalize(re.sub(r'[^\w]', '', word))
    return clean in ACCENT_PATTERNS


def rgb_to_ass(hex_color):
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def format_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_ass_cove(words, accent_hex="#E85A4F", font_size=72, wpl=4, lines=2,
                      font="Instrument Sans", accent_font="Playfair Display"):
    """Generate ASS with dual-font: normal in sans-serif bold, accent in serif italic."""
    accent_color = rgb_to_ass(accent_hex)
    white = "&H00FFFFFF&"
    outline_color = "&H00000000&"

    header = f"""[Script Info]
Title: Cove Style Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{font_size},{white},&H000000FF&,{outline_color},&H80000000&,-1,0,0,0,100,100,1,0,1,3,2,5,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    block_size = wpl * lines

    blocks = []
    for i in range(0, len(words), block_size):
        blocks.append(words[i:i + block_size])

    for block in blocks:
        block_start = format_time(block[0]['start'])
        block_end = format_time(block[-1]['end'])

        # Build display text with accent words in italic serif + color
        parts = []
        for j, w in enumerate(block):
            word_text = w.get('word') or w.get('text', '')
            if is_accent_word(word_text):
                # Switch to accent font (italic serif) + accent color
                parts.append(
                    f"{{\\fn{accent_font}\\i1\\c{accent_color}}}"
                    f"{word_text}"
                    f"{{\\fn{font}\\i0\\c{white}}}"
                )
            else:
                parts.append(word_text)

            if (j + 1) % wpl == 0 and j + 1 < len(block):
                parts.append("\\N")
            else:
                parts.append(" ")

        text = "".join(parts).strip()
        events.append(f"Dialogue: 0,{block_start},{block_end},Default,,0,0,0,,{text}")

    return header + "\n".join(events) + "\n"


def burn_subtitles(video_path, ass_path, output_path):
    """Burn ASS subtitles into video using FFmpeg."""
    fonts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
    escaped_ass = ass_path.replace(":", "\\:").replace("'", "\\'")
    escaped_fonts = fonts_dir.replace(":", "\\:").replace("'", "\\'")
    vf = f"ass={escaped_ass}:fontsdir={escaped_fonts}"

    ffmpeg = os.environ.get('FFMPEG_PATH', 'ffmpeg')

    cmd = [
        ffmpeg, '-y',
        '-i', video_path,
        '-vf', vf,
        '-c:v', 'libx264', '-crf', '18', '-r', '30000/1001',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        output_path
    ]
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg error: {result.stderr[-800:]}", file=sys.stderr)
        sys.exit(1)
    return output_path


if __name__ == '__main__':
    # Args: video_path transcription_json output_path [accent_hex] [font_size] [wpl] [lines]
    video_path = sys.argv[1]
    trans_path = sys.argv[2]
    output_path = sys.argv[3]
    accent_hex = sys.argv[4] if len(sys.argv) > 4 else "#E85A4F"
    font_size = int(sys.argv[5]) if len(sys.argv) > 5 else 72
    wpl = int(sys.argv[6]) if len(sys.argv) > 6 else 4
    lines_count = int(sys.argv[7]) if len(sys.argv) > 7 else 2

    with open(trans_path, 'r') as f:
        words = json.load(f)

    ass_content = generate_ass_cove(words, accent_hex, font_size, wpl, lines_count)
    ass_path = output_path.rsplit('.', 1)[0] + '.ass'
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(ass_content)
    print(f"ASS generated: {ass_path}")
    print(f"Accent words detected: {sum(1 for w in words if is_accent_word(w.get('word') or w.get('text', '')))}/{len(words)}")

    burn_subtitles(video_path, ass_path, output_path)
    print(f"Subtitled video: {output_path}")
