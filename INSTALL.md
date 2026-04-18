# Installation — Montage Video

Application web locale pour le montage video automatise avec Claude.
Deux modes : **Video** (montage, sous-titres, teasers) et **Miniature** (thumbnails IA style YouTube).

**Un abonnement Claude (Max ou Pro) est requis.**

---

## Docker (recommande — Mac + Windows)

Tout est installe automatiquement : Node.js, Python, FFmpeg, Whisper, Claude CLI, nano-banana (miniatures IA).

### Ce qu'il faut installer

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
   - Windows : WSL2 requis (Docker Desktop le propose a l'installation)

2. **Claude CLI** — pour l'authentification :
   - Installe Node.js : https://nodejs.org/
   - Puis dans un terminal :
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude login
   ```

3. **Cle API Gemini** (gratuite, pour les miniatures IA) :
   - Va sur https://aistudio.google.com/apikey
   - Cree une cle — le script la demandera au premier lancement

### Lancer

**Mac :** Double-clique `start.command`
**Windows :** Double-clique `start.bat`

Le script gere tout :
- Rafraichit le token Claude (automatique sur Mac via le trousseau)
- Demande la cle Gemini au premier lancement
- Construit l'image Docker (~5-10 min la premiere fois)
- Ouvre http://localhost:3000

Les lancements suivants sont instantanes.

### Arreter

Ctrl+C dans le terminal, ou `docker compose down`

### Reconstruire (apres mise a jour)

```bash
docker compose build --no-cache
```

### Note Windows

Sur Windows, le token Claude ne peut pas etre extrait automatiquement du trousseau.
Au premier lancement, `start.bat` te demandera de coller ton token manuellement :
1. Lance `claude setup-token` dans un terminal
2. Copie le token affiche
3. Colle-le quand le script le demande

### Depannage

| Probleme | Solution |
|----------|----------|
| "Docker n'est pas installe" | Installe Docker Desktop |
| "Docker n'est pas demarre" | Lance Docker Desktop |
| Erreur d'authentification Claude | Relance `claude login` puis relance le script |
| Build echoue | Verifie ta connexion internet, `docker compose build --no-cache` |
| Port 3000 occupe | Change le port dans `docker-compose.yml` |
| Miniatures basiques (pas IA) | Verifie que `GEMINI_API_KEY` est dans `.env` |
| Transcription lente | Normal : ~1-3 min par minute de video |

---

## Installation native (Mac uniquement, sans Docker)

Pour ceux qui preferent ne pas utiliser Docker.

```bash
# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js + Python + FFmpeg
brew install node python3 ffmpeg

# FFmpeg avec libass (pour les sous-titres ASS)
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass

# Claude CLI
npm install -g @anthropic-ai/claude-code
claude login

# Python deps
pip3 install openai-whisper Pillow

# Bun + nano-banana (miniatures IA)
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/kingbootoshi/nano-banana-2-skill.git ~/tools/nano-banana-2
cd ~/tools/nano-banana-2 && bun install && bun link
mkdir -p ~/.nano-banana && echo "GEMINI_API_KEY=ta_cle_ici" > ~/.nano-banana/.env

# Dependances Node du projet
cd /chemin/vers/le/projet
npm install
```

Lancer : double-clique `start-native.command` ou `npm run dev`

---

## Utilisation

### Mode Video
1. Selectionne **Video** en haut
2. Upload tes videos (MP4, MOV, etc.)
3. Ecris ton prompt ("Fais un reel de 30s avec les meilleurs moments")
4. Choisis le style de sous-titres (Hormozi, Cove, MrBeast, etc.)
5. Configure : type (teaser/longue/multi), duree, format (9:16, 16:9), langue
6. Clique "Lancer le montage"
7. Telecharge les videos produites

### Mode Miniature
1. Selectionne **Miniature** en haut
2. Upload la video source (pour extraire les meilleures frames)
3. Upload une **image de reference** (la miniature dont tu veux t'inspirer)
4. Ecris ton prompt ("Miniature YouTube style gaming avec texte gros")
5. Optionnel : texte a afficher, nombre de miniatures (defaut 2), couleur accent
6. Clique "Generer les miniatures"
7. Resultat : miniature 1 = fidele a la reference, miniature 2 = variante creative

## Comment ca marche

```
Interface web (localhost:3000)
       |
       v
   worker.mjs — orchestre Claude CLI
       |
       v
   Claude (claude -p) — agent autonome
       |
       +-- Mode Video :
       |     transcribe.py (Whisper) → ffmpeg (decoupe) →
       |     burn_subtitles.py (sous-titres) → generate_text_frame.py →
       |     ffmpeg (assemblage) → video finale
       |
       +-- Mode Miniature :
             ffmpeg (extraction frames) → nano-banana (generation IA Gemini) →
             miniatures style reference
```

## Architecture

```
start.command          <- Double-clic Mac (Docker)
start.bat              <- Double-clic Windows (Docker)
start-native.command   <- Double-clic Mac (sans Docker)
Dockerfile             <- Image Docker (Node, Python, FFmpeg, Whisper, Bun, nano-banana)
docker-compose.yml     <- Config Docker
.env                   <- Tokens Claude + Gemini (gitignore)
app/                   <- Interface web Next.js
worker.mjs             <- Orchestre Claude CLI
pipeline/
  scripts/             <- Python (transcribe, burn_subtitles, text_frame, generate_thumbnail)
  fonts/               <- BigShoulders, InstrumentSans, PlayfairDisplay
  styles.json          <- 7 presets sous-titres
jobs/                  <- Uploads + resultats (cree automatiquement)
```
