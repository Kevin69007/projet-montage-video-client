#!/bin/bash
#
# Montage Video — Mac Docker Launcher
# Double-cliquer ce fichier pour demarrer.
#

cd "$(dirname "$0")"

echo ""
echo "=================================="
echo "   MONTAGE VIDEO"
echo "=================================="
echo ""

# --- Check Docker ---

if ! command -v docker &>/dev/null; then
  echo "ERREUR: Docker n'est pas installe."
  echo ""
  echo "Telecharge Docker Desktop :"
  echo "  https://www.docker.com/products/docker-desktop/"
  echo ""
  read -p "Appuie sur Entree pour fermer..."
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo "ERREUR: Docker n'est pas demarre."
  echo "Lance Docker Desktop, puis relance ce script."
  echo ""
  read -p "Appuie sur Entree pour fermer..."
  exit 1
fi

echo "Docker: OK"

# --- Check Claude auth token ---

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ] || ! grep -q "CLAUDE_CODE_OAUTH_TOKEN=sk-" "$ENV_FILE" 2>/dev/null; then
  echo ""
  echo "========================================="
  echo "  CONNEXION CLAUDE (une seule fois)"
  echo "========================================="
  echo ""

  # Try extracting token from macOS Keychain (where claude login stores it)
  TOKEN=""
  if command -v security &>/dev/null; then
    CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    if [ -n "$CREDS" ]; then
      TOKEN=$(echo "$CREDS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['claudeAiOauth']['accessToken'])" 2>/dev/null)
    fi
  fi

  if [ -n "$TOKEN" ] && echo "$TOKEN" | grep -q "^sk-ant-"; then
    echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" > "$ENV_FILE"
    echo "Token extrait du trousseau macOS."
  else
    echo "Impossible d'extraire le token automatiquement."
    echo ""
    echo "Assure-toi d'etre connecte a Claude :"
    echo "  claude login"
    echo ""
    echo "Puis relance ce script."
    echo ""
    echo "Ou cree manuellement un fichier .env avec :"
    echo "  CLAUDE_CODE_OAUTH_TOKEN=ton_token_ici"
    echo "  (obtenu via 'claude setup-token')"
    echo ""
    read -p "Appuie sur Entree pour fermer..."
    exit 1
  fi
fi

echo "Token Claude: OK"

# --- Check Gemini API key (for AI thumbnail generation) ---

if ! grep -q "GEMINI_API_KEY=" "$ENV_FILE" 2>/dev/null; then
  echo ""
  echo "========================================="
  echo "  GEMINI API KEY (pour les miniatures)"
  echo "========================================="
  echo ""
  echo "Pour generer des miniatures avec l'IA, tu as besoin"
  echo "d'une cle API Gemini (gratuite)."
  echo ""
  echo "1. Va sur https://aistudio.google.com/apikey"
  echo "2. Cree une cle API"
  echo "3. Colle-la ici :"
  echo ""
  read -p "Gemini API Key: " GEMINI_KEY

  if [ -n "$GEMINI_KEY" ]; then
    echo "GEMINI_API_KEY=$GEMINI_KEY" >> "$ENV_FILE"
    echo "Cle Gemini sauvegardee."
  else
    echo "Pas de cle Gemini — les miniatures AI ne fonctionneront pas."
    echo "(Tu peux l'ajouter plus tard dans .env : GEMINI_API_KEY=ta_cle)"
  fi
fi

echo "Gemini: $(grep -q 'GEMINI_API_KEY=' "$ENV_FILE" 2>/dev/null && echo 'OK' || echo 'Non configure')"

# --- Build and start ---

echo ""
echo "Demarrage du conteneur..."
echo "(Premier lancement = build de l'image, ~5-10 min)"
echo ""

docker compose up --build -d 2>&1

if [ $? -ne 0 ]; then
  echo ""
  echo "ERREUR: Le build Docker a echoue."
  echo "Verifie ta connexion internet et reessaie."
  echo ""
  read -p "Appuie sur Entree pour fermer..."
  exit 1
fi

# Wait for container to be ready
echo "Attente du demarrage..."
sleep 5

# --- Open browser ---

echo ""
echo "========================================="
echo "  PRET !"
echo "========================================="
echo ""
echo "  Interface : http://localhost:3000"
echo "  Arreter   : Ctrl+C ou 'docker compose down'"
echo ""

open http://localhost:3000

# Handle Ctrl+C
trap "echo ''; echo 'Arret...'; docker compose down; exit 0" INT TERM

# Follow logs
docker compose logs -f app
