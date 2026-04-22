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

ENV_FILE=".env"
touch "$ENV_FILE"

# --- Check Kimi API key ---

if ! grep -q "KIMI_API_KEY=sk-" "$ENV_FILE" 2>/dev/null; then
  echo ""
  echo "========================================="
  echo "  KIMI API KEY (pour l'IA)"
  echo "========================================="
  echo ""
  echo "Pour le montage IA, tu as besoin d'une cle API Kimi."
  echo ""
  echo "1. Va sur https://platform.moonshot.ai/"
  echo "2. Cree un compte et une cle API"
  echo "3. Colle-la ici :"
  echo ""
  read -p "Kimi API Key: " KIMI_KEY

  if [ -z "$KIMI_KEY" ]; then
    echo "Aucune cle entree. Le pipeline ne peut pas demarrer."
    read -p "Appuie sur Entree pour fermer..."
    exit 1
  fi

  # Remove any existing KIMI_API_KEY line, then append
  grep -v "^KIMI_API_KEY=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
  mv "$ENV_FILE.tmp" "$ENV_FILE" 2>/dev/null || true
  echo "KIMI_API_KEY=$KIMI_KEY" >> "$ENV_FILE"
  echo "Cle Kimi sauvegardee."
fi

echo "Kimi: OK"

# --- Check Gemini API key (for thumbnails) ---

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
  echo "3. Colle-la ici (ou laisse vide pour sauter) :"
  echo ""
  read -p "Gemini API Key: " GEMINI_KEY

  if [ -n "$GEMINI_KEY" ]; then
    echo "GEMINI_API_KEY=$GEMINI_KEY" >> "$ENV_FILE"
    echo "Cle Gemini sauvegardee."
  else
    echo "Pas de cle Gemini — les miniatures AI ne fonctionneront pas."
  fi
fi

echo "Gemini: $(grep -q 'GEMINI_API_KEY=.' "$ENV_FILE" 2>/dev/null && echo 'OK' || echo 'Non configure')"

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

trap "echo ''; echo 'Arret...'; docker compose down; exit 0" INT TERM

docker compose logs -f app
