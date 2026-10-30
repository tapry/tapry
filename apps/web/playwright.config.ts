import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Run through `pnpm test:e2e`, which starts a throwaway SeaweedFS and sets S3_E2E_*.
const PORT = 3100;
const dbDir = mkdtempSync(join(tmpdir(), "opentake-e2e-db-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    // E2E_BASE_URL: test an already running install (e.g. the Docker stack) instead of starting one.
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    permissions: ["camera", "microphone"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Full Chromium (new headless). The default headless shell hangs on the fake camera on macOS.
        channel: "chromium",
        launchOptions: {
          // Chromium's built-in fake camera (test pattern) and mic (a beep every second),
          // with the permission prompt auto-accepted.
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/time`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: `pglite://${dbDir}`,
      S3_ENDPOINT: process.env.S3_E2E_ENDPOINT ?? "",
      S3_BUCKET: "opentake-e2e",
      S3_ACCESS_KEY_ID: process.env.S3_E2E_ACCESS_KEY_ID ?? "",
      S3_SECRET_ACCESS_KEY: process.env.S3_E2E_SECRET_ACCESS_KEY ?? "",
      // Recordings are processed in-process; pass FFMPEG_PATH / FFPROBE_PATH if they are not on PATH.
      FFMPEG_PATH: process.env.FFMPEG_PATH ?? "ffmpeg",
      FFPROBE_PATH: process.env.FFPROBE_PATH ?? "ffprobe",
      // Live call when scripts/with-seaweedfs.mjs started LiveKit (LIVEKIT_BIN set); otherwise
      // explicitly off, so a LIVEKIT_URL in .env.local (which next dev also reads) can't leak in.
      LIVEKIT_URL: process.env.LIVEKIT_E2E_URL ?? "",
      LIVEKIT_API_KEY: process.env.LIVEKIT_E2E_API_KEY ?? "",
      LIVEKIT_API_SECRET: process.env.LIVEKIT_E2E_API_SECRET ?? "",
    },
  },
});
