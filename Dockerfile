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
    printf '#!/bin/bash\nexec /root/.bun/bin/bun run /opt/nano-banana/src/cli.ts "$@"\n' > /usr/local/bin/nano-banana && \
    chmod +x /usr/local/bin/nano-banana

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

# Create jobs directory
RUN mkdir -p /app/jobs

# Environment
ENV FFMPEG_PATH=ffmpeg
ENV FONTS_DIR=/app/pipeline/fonts
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
