# Installation — Montage Video

Application web locale pour le montage video automatise avec Claude.
Upload tes videos, ecris un prompt, et Claude produit des videos montees (teasers, reels, version longue).

**Un abonnement Claude (Max ou Pro) est requis** — pas de cle API.

---

## Methode 1 : Docker (recommande — Mac + Windows)

Tout est installe automatiquement dans le conteneur Docker : Node.js, Python, FFmpeg, Whisper, Claude CLI.

### Pre-requis

1. **Docker Desktop** — telecharge et installe depuis https://www.docker.com/products/docker-desktop/
   - **Windows** : necessite WSL2 (Docker Desktop le propose a l'installation). Redemarrer le PC si demande.

2. **Claude CLI** (sur ta machine, pas dans Docker) — necessaire uniquement pour generer le token d'authentification :
   - Installe Node.js si besoin : https://nodejs.org/ (Mac : `brew install node`)
   - Puis :
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

### Premier lancement

**Mac :** Double-clique sur `start.command`
**Windows :** Double-clique sur `start.bat`

Le script fait tout automatiquement :

1. Verifie que Docker est installe et demarre
2. Genere un token Claude (ouvre ton navigateur pour te connecter — **une seule fois**)
3. Sauvegarde le token dans un fichier `.env` (valable 1 an)
4. Construit l'image Docker (~5-10 min la premiere fois)
5. Demarre le serveur et ouvre http://localhost:3000

### Lancements suivants

**Mac :** Double-clique `start.command`
**Windows :** Double-clique `start.bat`

L'interface s'ouvre automatiquement. Pas de login, pas de configuration.

### Arreter

Ctrl+C dans le terminal, ou :
```bash
docker compose down
```

### Mise a jour

Pour reconstruire l'image (nouvelle version de Claude CLI, Whisper, etc.) :
```bash
docker compose build --no-cache
```

### Renouveler le token Claude

Le token expire apres 1 an. Pour le renouveler :
```bash
claude setup-token
```
Puis remplace la ligne `CLAUDE_CODE_OAUTH_TOKEN=...` dans le fichier `.env`.

### Depannage

| Probleme | Solution |
|----------|----------|
| "Docker n'est pas installe" | Telecharge Docker Desktop : https://www.docker.com/products/docker-desktop/ |
| "Docker n'est pas demarre" | Lance Docker Desktop, puis relance le script |
| "Claude CLI n'est pas installe" | `npm install -g @anthropic-ai/claude-code` |
| Token invalide / expire | `claude setup-token` puis mets a jour `.env` |
| Build Docker echoue | Verifie ta connexion internet, relance `docker compose build` |
| Port 3000 occupe | Arrete le service qui l'utilise, ou change le port dans `docker-compose.yml` |
| Transcription lente | Normal : ~1-3 min par minute de video avec Whisper |
| "Aucun fichier produit" | Verifie les logs dans la page de progression |

---

## Methode 2 : Installation native (Mac uniquement, sans Docker)

Pour ceux qui preferent ne pas utiliser Docker. Necessite d'installer chaque dependance manuellement.

### Pre-requis

```bash
# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js
brew install node

# Python 3
brew install python3

# FFmpeg + libass (pour les sous-titres)
brew install ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass

# Claude CLI
npm install -g @anthropic-ai/claude-code
claude login

# Python deps
pip3 install openai-whisper Pillow

# Dependances Node du projet
cd /chemin/vers/le/projet
npm install
```

### Lancer

Double-clique sur `start-native.command`

Ou dans le terminal :
```bash
npm run dev
# Ouvre http://localhost:3000
```

---

## Utilisation

1. **Upload** — Glisse tes videos (MP4, MOV, etc.)
2. **Prompt** — Decris ce que tu veux ("Fais un reel de 30s avec les meilleurs moments")
3. **Style** — Choisis le style de sous-titres (Hormozi, Cove, MrBeast, etc.)
4. **Options** — Type (teaser/longue/multi), duree, format (9:16, 16:9), langue
5. **Lancer** — Clique sur "Lancer le montage"
6. **Resultat** — Attends le pipeline (transcription, decoupe, sous-titres, assemblage)
7. **Download** — Telecharge les fichiers produits

## Architecture

```
start.command          <- Double-clic Mac (Docker)
start.bat              <- Double-clic Windows (Docker)
start-native.command   <- Double-clic Mac (sans Docker)
Dockerfile             <- Image Docker avec toutes les deps
docker-compose.yml     <- Config Docker
.env                   <- Token Claude (genere automatiquement, gitignore)
app/                   <- Interface web Next.js
worker.mjs             <- Orchestre Claude CLI pour le pipeline
pipeline/
  scripts/             <- Python (transcribe, burn_subtitles, text_frame)
  fonts/               <- Polices (BigShoulders, InstrumentSans, PlayfairDisplay)
  styles.json          <- 7 presets de sous-titres
jobs/                  <- Videos uploadees + resultats (cree automatiquement)
```

## Comment ca marche

1. Tu uploades des videos et ecris un prompt
2. Le serveur cree un job et lance `worker.mjs`
3. `worker.mjs` appelle `claude -p` (Claude CLI) avec ton prompt + les instructions de montage
4. Claude analyse, decoupe, sous-titre et assemble automatiquement via :
   - `transcribe.py` (Whisper) pour la transcription
   - `ffmpeg` pour la decoupe et l'assemblage
   - `burn_subtitles.py` pour les sous-titres
   - `generate_text_frame.py` pour les ecrans de fin
5. Les fichiers produits apparaissent dans l'interface pour telechargement
