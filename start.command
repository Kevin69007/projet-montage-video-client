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

if [ ! -f "$ENV_FILE" ] || ! grep -q "CLAUDE_CODE_OAUTH_TOKEN" "$ENV_FILE" 2>/dev/null; then
  echo ""
  echo "========================================="
  echo "  CONNEXION CLAUDE (une seule fois)"
  echo "========================================="
  echo ""
  echo "Claude CLI a besoin d'un token d'authentification."
  echo ""

  # Check if claude CLI is available on host
  CLAUDE_HOST=""
  if [ -f "$HOME/.local/bin/claude" ]; then
    CLAUDE_HOST="$HOME/.local/bin/claude"
  elif command -v claude &>/dev/null; then
    CLAUDE_HOST="$(command -v claude)"
  fi

  if [ -n "$CLAUDE_HOST" ]; then
    echo "Generation du token..."
    echo "Si une fenetre de navigateur s'ouvre, connecte-toi avec ton compte Claude."
    echo ""
    TOKEN=$("$CLAUDE_HOST" setup-token 2>&1 | grep -oE '[a-zA-Z0-9_-]{20,}' | tail -1)

    if [ -n "$TOKEN" ]; then
      echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" > "$ENV_FILE"
      echo "Token sauvegarde dans .env"
    else
      echo "Impossible de generer le token automatiquement."
      echo ""
      echo "Lance manuellement dans un terminal :"
      echo "  claude setup-token"
      echo ""
      echo "Puis copie le token et cree un fichier .env avec :"
      echo "  CLAUDE_CODE_OAUTH_TOKEN=ton_token_ici"
      echo ""
      read -p "Appuie sur Entree pour fermer..."
      exit 1
    fi
  else
    echo "Claude CLI n'est pas installe sur ta machine."
    echo ""
    echo "Pour generer le token, installe Claude CLI :"
    echo "  npm install -g @anthropic-ai/claude-code"
    echo "  claude setup-token"
    echo ""
    echo "Puis cree un fichier .env dans ce dossier avec :"
    echo "  CLAUDE_CODE_OAUTH_TOKEN=ton_token_ici"
    echo ""
    read -p "Appuie sur Entree pour fermer..."
    exit 1
  fi
fi

echo "Token Claude: OK"

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
