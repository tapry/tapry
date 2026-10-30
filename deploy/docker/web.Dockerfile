# syntax=docker/dockerfile:1.7
# OpenTake web app (studio UI, API, and in-process recording processing).
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
 && pnpm --filter @opentake/web build

FROM node:22-bookworm-slim AS runtime
# ffmpeg from Debian (5.1: libx264, libopus, libvpx) for recording processing; curl for the health check.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe
RUN useradd --system --uid 1001 --home-dir /app opentake
WORKDIR /app
COPY --from=build --chown=opentake /repo/apps/web/.next/standalone ./
COPY --from=build --chown=opentake /repo/apps/web/.next/static ./apps/web/.next/static
USER opentake
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
