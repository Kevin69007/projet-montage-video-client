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

# --- Check Claude auth ---

echo "Verification de la connexion Claude..."
CLAUDE_CHECK=$(docker compose exec -T app claude -p "say ok" --output-format json --no-session-persistence 2>&1)

if echo "$CLAUDE_CHECK" | grep -qi "not logged in\|authentication_failed\|login"; then
  echo ""
  echo "========================================="
  echo "  CONNEXION CLAUDE"
  echo "========================================="
  echo ""
  echo "Claude n'est pas encore connecte."
  echo "Une fenetre de connexion va s'ouvrir..."
  echo ""

  # Run claude login interactively inside the container
  docker compose exec app claude login

  if [ $? -ne 0 ]; then
    echo ""
    echo "La connexion a echoue. Reessaie en lancant :"
    echo "  cd $(pwd)"
    echo "  docker compose exec app claude login"
    echo ""
    read -p "Appuie sur Entree pour fermer..."
    docker compose down
    exit 1
  fi

  echo ""
  echo "Connexion reussie !"
  echo ""
fi

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
