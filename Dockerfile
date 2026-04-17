FROM node:20-slim

# System dependencies: Python, FFmpeg, ImageMagick (for nano-banana transparent mode), build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    ffmpeg \
    imagemagick \
    build-essential \
    git \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies (Whisper + Pillow)
RUN pip3 install --break-system-packages openai-whisper Pillow

# Pre-download Whisper 'small' model (~500MB) so first run is instant
RUN python3 -c "import whisper; whisper.load_model('small')"

# Install Bun (needed for nano-banana)
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="/root/.bun/bin:$PATH"

# Install nano-banana (AI image generation via Gemini)
RUN git clone https://github.com/kingbootoshi/nano-banana-2-skill.git /opt/nano-banana && \
    cd /opt/nano-banana && \
    bun install && \
    printf '#!/bin/bash\nBUN=$(command -v bun || echo "$HOME/.bun/bin/bun")\nexec "$BUN" run /opt/nano-banana/src/cli.ts "$@"\n' > /usr/local/bin/nano-banana && \
    chmod +x /usr/local/bin/nano-banana

# Claude CLI (auth tokens via env var)
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

# Copy Whisper model cache + bun to appuser home
RUN cp -r /root/.cache /home/appuser/.cache 2>/dev/null; \
    cp -r /root/.bun /home/appuser/.bun 2>/dev/null; \
    mkdir -p /home/appuser/.nano-banana && \
    chown -R appuser:appuser /home/appuser && \
    chown -R appuser:appuser /opt/nano-banana

# Switch to non-root user
USER appuser

# Environment
ENV FFMPEG_PATH=ffmpeg
ENV FONTS_DIR=/app/pipeline/fonts
ENV NODE_ENV=production
ENV HOME=/home/appuser
ENV PATH="/home/appuser/.bun/bin:/usr/local/bin:$PATH"

EXPOSE 3000

CMD ["npm", "start"]
