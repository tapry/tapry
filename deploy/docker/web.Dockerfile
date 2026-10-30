# syntax=docker/dockerfile:1.7
# OpenTake web app (studio UI, API) and worker (`node worker.cjs`: recording processing + transcripts).
# Build from the repo root:  docker build -f deploy/docker/web.Dockerfile -t opentake/web .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first, so dependency installs are cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/recorder/package.json packages/recorder/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @opentake/shared --filter @opentake/recorder --filter @opentake/worker build \
 && pnpm --filter @opentake/web build \
 && pnpm --filter @opentake/web build:worker

# whisper.cpp for transcripts, built for the image's CPU family (not -march=native, so the
# image runs on any x86-64 / arm64 host), plus the model and the voice-activity model.
FROM debian:bookworm-slim AS whisper
ARG WHISPER_VERSION=1.9.5
# "base" (multilingual, 148 MB). For "small" also pass its SHA-256 from
# https://huggingface.co/ggerganov/whisper.cpp (file list → ggml-small.bin).
ARG WHISPER_MODEL=base
ARG WHISPER_MODEL_SHA256=60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe
ARG VAD_MODEL=ggml-silero-v6.2.0.bin
ARG VAD_MODEL_SHA256=2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION}.tar.gz" | tar -xz --strip-components=1 \
 && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build build -j"$(nproc)" --target whisper-cli \
 && mkdir -p /out && cp build/bin/whisper-cli /out/
RUN curl -fsSL -o "/out/ggml-${WHISPER_MODEL}.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin" \
 && echo "${WHISPER_MODEL_SHA256}  /out/ggml-${WHISPER_MODEL}.bin" | sha256sum -c - \
 && curl -fsSL -o "/out/${VAD_MODEL}" "https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD_MODEL}" \
 && echo "${VAD_MODEL_SHA256}  /out/${VAD_MODEL}" | sha256sum -c -

FROM node:22-bookworm-slim AS runtime
ARG WHISPER_MODEL=base
# Set by the release workflow; shown by /api/health.
ARG OPENTAKE_VERSION=dev
ARG VAD_MODEL=ggml-silero-v6.2.0.bin
# ffmpeg from Debian (5.1: libx264, libopus, libvpx); DejaVu for names on the combined video;
# libgomp1 for whisper.cpp; curl for the health check.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core libgomp1 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /out/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /out/*.bin /opt/whisper/
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 OPENTAKE_VERSION=${OPENTAKE_VERSION} \
    FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe \
    WHISPER_PATH=/usr/local/bin/whisper-cli \
    WHISPER_MODEL=/opt/whisper/ggml-${WHISPER_MODEL}.bin \
    WHISPER_VAD_MODEL=/opt/whisper/${VAD_MODEL}
RUN useradd --system --uid 1001 --home-dir /app opentake
WORKDIR /app
COPY --from=build --chown=opentake /repo/apps/web/.next/standalone ./
COPY --from=build --chown=opentake /repo/apps/web/.next/static ./apps/web/.next/static
# The standalone worker (docker-compose `worker` service): one bundled file.
COPY --from=build --chown=opentake /repo/apps/web/dist-worker/worker.cjs ./worker.cjs
USER opentake
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
