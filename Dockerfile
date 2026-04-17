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

# App setup
WORKDIR /app

# Install Node dependencies (cached layer)
COPY package*.json ./
RUN npm ci --production

# Copy app source
COPY . .

# Build Next.js
RUN npm run build

# Create jobs directory
RUN mkdir -p /app/jobs

# Environment
ENV FFMPEG_PATH=ffmpeg
ENV FONTS_DIR=/app/pipeline/fonts
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
