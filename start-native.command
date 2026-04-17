#!/bin/bash
#
# Montage Video Local — Mac Launcher
# Double-cliquer ce fichier pour demarrer l'interface web.
#

cd "$(dirname "$0")"

echo ""
echo "=================================="
echo "   MONTAGE VIDEO LOCAL"
echo "=================================="
echo ""

# --- Check dependencies ---

check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERREUR: '$1' n'est pas installe."
    echo "  → $2"
    echo ""
    MISSING=1
  fi
}

MISSING=0

check_dep node "Installe avec: brew install node"
check_dep python3 "Installe avec: brew install python3"
check_dep ffmpeg "Installe avec: brew install ffmpeg"

# Check Claude CLI
CLAUDE_PATH=""
if [ -f "$HOME/.local/bin/claude" ]; then
  CLAUDE_PATH="$HOME/.local/bin/claude"
elif command -v claude &>/dev/null; then
  CLAUDE_PATH="$(command -v claude)"
fi

if [ -z "$CLAUDE_PATH" ]; then
  echo "ERREUR: Claude CLI non trouve."
  echo "  → Installe avec: npm install -g @anthropic-ai/claude-code"
  echo "  → Puis connecte-toi: claude login"
  MISSING=1
else
  echo "Claude CLI: $CLAUDE_PATH"
fi

# Check Whisper
python3 -c "import whisper" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "ERREUR: openai-whisper non installe."
  echo "  → Installe avec: pip3 install openai-whisper"
  MISSING=1
else
  echo "Whisper: OK"
fi

# Check Pillow
python3 -c "from PIL import Image" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "ERREUR: Pillow non installe."
  echo "  → Installe avec: pip3 install Pillow"
  MISSING=1
else
  echo "Pillow: OK"
fi

if [ $MISSING -ne 0 ]; then
  echo ""
  echo "Certaines dependances manquent. Voir INSTALL.md pour le guide complet."
  echo ""
  read -p "Appuie sur Entree pour fermer..."
  exit 1
fi

# --- Check ffmpeg-full (for subtitle burning with libass) ---

FFMPEG_FULL="/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
if [ -f "$FFMPEG_FULL" ]; then
  export FFMPEG_PATH="$FFMPEG_FULL"
  echo "FFmpeg (libass): $FFMPEG_FULL"
else
  # Check if standard ffmpeg has ass filter
  if ffmpeg -filters 2>&1 | grep -q "^.*ass.*"; then
    export FFMPEG_PATH="ffmpeg"
    echo "FFmpeg (libass): OK (standard)"
  else
    export FFMPEG_PATH="ffmpeg"
    echo ""
    echo "ATTENTION: ffmpeg-full (avec libass) non installe."
    echo "  Les sous-titres ASS ne fonctionneront pas."
    echo "  Pour installer: brew tap homebrew-ffmpeg/ffmpeg"
    echo "                  brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass"
    echo ""
  fi
fi

# --- Install Node dependencies if needed ---

if [ ! -d "node_modules" ]; then
  echo ""
  echo "Installation des dependances Node..."
  npm install
  echo ""
fi

# --- Add paths ---

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# --- Start the server ---

echo ""
echo "Demarrage du serveur..."
echo "Interface: http://localhost:3000"
echo ""
echo "Ctrl+C pour arreter"
echo "=================================="
echo ""

# Start Next.js dev server in background
npx next dev --port 3000 &
SERVER_PID=$!

# Wait for server to be ready
sleep 4

# Open in browser
open http://localhost:3000

# Handle Ctrl+C gracefully
trap "echo ''; echo 'Arret du serveur...'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM

# Wait for server process
wait $SERVER_PID
