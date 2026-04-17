FROM node:20-slim

# System dependencies: Python, FFmpeg (Debian includes libass), build tools for Whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    ffmpeg \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies (Whisper + Pillow)
RUN pip3 install --break-system-packages openai-whisper Pillow

# Pre-download Whisper 'small' model (~500MB) so first run is instant
RUN python3 -c "import whisper; whisper.load_model('small')"

# Claude CLI (auth tokens will be mounted from host)
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (Claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash appuser

# App setup
WORKDIR /app

# Install ALL Node dependencies (devDeps needed for build: tailwindcss, postcss)
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

# Build Next.js
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Create jobs directory and set ownership
RUN mkdir -p /app/jobs && chown -R appuser:appuser /app

# Copy Whisper model cache to appuser's home
RUN cp -r /root/.cache /home/appuser/.cache && chown -R appuser:appuser /home/appuser/.cache

# Switch to non-root user
USER appuser

# Environment
ENV FFMPEG_PATH=ffmpeg
ENV FONTS_DIR=/app/pipeline/fonts
ENV NODE_ENV=production
ENV HOME=/home/appuser

EXPOSE 3000

CMD ["npm", "start"]
