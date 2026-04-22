# Installation — Montage Video

Application web locale pour le montage video automatise avec l'IA Kimi (Moonshot AI).
Deux modes : **Video** (montage, sous-titres, teasers) et **Miniature** (thumbnails IA style YouTube).

**Aucun abonnement requis** — paie uniquement a l'utilisation via API.

---

## Installation (Mac + Windows)

Tout est installe automatiquement dans le conteneur Docker : Node.js, Python, FFmpeg, Whisper, nano-banana (miniatures IA).

### Ce qu'il faut installer sur ta machine

**Une seule chose : Docker Desktop**
- https://www.docker.com/products/docker-desktop/
- Windows : necessite WSL2 (Docker Desktop le propose a l'installation)

### Cles API necessaires

Les deux sont demandees au premier lancement et sauvegardees dans `.env` :

1. **Kimi API Key** (obligatoire — pour l'IA de montage)
   - Va sur https://platform.moonshot.ai/
   - Cree un compte, ajoute une methode de paiement
   - Genere une cle API (format `sk-...`)
   - Tarif : ~$0.035/job avec Kimi K2.5 (~5x moins cher que Claude Sonnet)

2. **Gemini API Key** (optionnel — pour les miniatures IA)
   - Va sur https://aistudio.google.com/apikey
   - Cree une cle (gratuite)
   - Si vide, les miniatures ne fonctionneront pas (mais le mode Video fonctionne)

### Lancer

**Mac :** Double-clique `start.command`
**Windows :** Double-clique `start.bat`

Le script fait tout automatiquement :
1. Verifie que Docker est installe et demarre
2. Demande la cle Kimi (premier lancement uniquement)
3. Demande la cle Gemini (premier lancement uniquement)
4. Construit l'image Docker (~5-10 min la premiere fois)
5. Demarre le serveur et ouvre http://localhost:3000

Les lancements suivants sont instantanes.

### Arreter

Ctrl+C dans le terminal, ou :
```bash
docker compose down
```

### Reconstruire (apres mise a jour du code)

```bash
docker compose build --no-cache
```

---

## Modele Kimi — Configuration avancee

Par defaut, le worker utilise `kimi-k2.5`. Tu peux changer via `.env` :

```
KIMI_API_KEY=sk-...
KIMI_MODEL=kimi-k2.5         # defaut — $0.60/M in, $2.50/M out
# KIMI_MODEL=kimi-k2.6       # plus recent, ~60% plus cher ($0.95/M in, $4.00/M out)
# KIMI_MODEL=kimi-k2-thinking  # reasoning, meme prix que K2.5
# KIMI_MODEL=kimi-k2-turbo-preview  # rapide mais cher ($8/M out)
```

Tous les modeles ont un contexte de 256K tokens, largement suffisant.

**Comparaison rapide :**

| Modele | Input (cached) | Input (miss) | Output | Cas d'usage |
|--------|----------------|--------------|--------|-------------|
| kimi-k2.5 | $0.15/M | $0.60/M | $2.50/M | **Defaut** — bon rapport qualite/prix |
| kimi-k2.6 | $0.16/M | $0.95/M | $4.00/M | Meilleure qualite pour taches complexes |
| kimi-k2-thinking | $0.15/M | $0.60/M | $2.50/M | Raisonnement — taches analytiques |
| kimi-k2-turbo-preview | $0.15/M | $1.15/M | $8.00/M | Reponses rapides, peu recommande |

---

## Depannage

| Probleme | Solution |
|----------|----------|
| "Docker n'est pas installe" | Installe Docker Desktop |
| "Docker n'est pas demarre" | Lance Docker Desktop |
| "KIMI_API_KEY non configuree" | Verifie que `.env` contient `KIMI_API_KEY=sk-...` |
| Erreur API Kimi 401 | Cle API invalide — regenere-la sur platform.moonshot.ai |
| Erreur API Kimi 402 | Credit insuffisant — ajoute un paiement sur platform.moonshot.ai |
| Build Docker echoue | Verifie ta connexion internet, `docker compose build --no-cache` |
| Port 3000 occupe | Change le port dans `docker-compose.yml` |
| Miniatures basiques | Ajoute `GEMINI_API_KEY=...` dans `.env` |
| Transcription lente | Normal : ~1-3 min par minute de video avec Whisper |
| "Aucun fichier produit" | Verifie les logs dans la page de progression |

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
5. Optionnel : texte, format (16:9, 9:16, 1:1, 4:5, 4:3), nombre, couleur accent
6. Clique "Generer les miniatures"
7. Resultat : miniature 1 = fidele a la reference, miniature 2 = variante creative

## Comment ca marche

```
Interface web (localhost:3000)
       |
       v
   worker.mjs — agent Kimi API
       |
       v
   Kimi K2.5 (API Moonshot) — decide des outils
       |
       +-- Bash : ffmpeg, python scripts
       +-- Read : fichiers, analyse images (via Kimi Vision)
       +-- Write : outputs.json, fichiers
       |
       +-- Mode Video :
       |     transcribe.py (Whisper) -> ffmpeg (decoupe) ->
       |     burn_subtitles.py (sous-titres) -> generate_text_frame.py ->
       |     ffmpeg (assemblage) -> video finale
       |
       +-- Mode Miniature :
             ffmpeg (extraction frames) -> nano-banana (Gemini) ->
             miniatures style reference
```

## Architecture

```
start.command          <- Double-clic Mac
start.bat              <- Double-clic Windows
Dockerfile             <- Image Docker (Node, Python, FFmpeg, Whisper, Bun, nano-banana)
docker-compose.yml     <- Config Docker
.env                   <- Cles Kimi + Gemini (gitignore)
app/                   <- Interface web Next.js
worker.mjs             <- Agent Kimi API (boucle tool_calls)
pipeline/
  scripts/             <- Python (transcribe, burn_subtitles, text_frame, generate_thumbnail)
  fonts/               <- BigShoulders, InstrumentSans, PlayfairDisplay
  styles.json          <- 7 presets sous-titres
jobs/                  <- Uploads + resultats (cree automatiquement)
```
