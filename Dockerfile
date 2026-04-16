# Stage 1: Build Next.js
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime with Python + FFmpeg
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libass-dev \
    && rm -rf /var/lib/apt/lists/*

# Create Python venv and install packages
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir openai-whisper Pillow

WORKDIR /app

# Copy built Next.js app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./

# Copy pipeline scripts, fonts, and styles
COPY pipeline/ ./pipeline/

# Create jobs directory
RUN mkdir -p /app/jobs

# Environment
ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
