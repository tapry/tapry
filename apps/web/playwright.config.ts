import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const MATRIX = /matrix\.spec\.ts/;
/** Specs every engine runs: the recording matrix and the cross-engine live call. */
const ENGINES = /(matrix|call)\.spec\.ts/;

// Run through `pnpm test:e2e`, which starts a throwaway SeaweedFS and sets S3_E2E_*.
const PORT = 3100;
const dbDir = mkdtempSync(join(tmpdir(), "opentake-e2e-db-"));

export default defineConfig<{ forceMp4: boolean }>({
  testDir: "e2e",
  // Long enough to wait for a recording to be processed inside one test.
  timeout: 180_000,
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
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            // Headless still plays sound: keep the fake mics' beeps off the speakers.
            "--mute-audio",
            // E2E_CHROMIUM_ARGS (JSON array): extra flags, e.g. --host-resolver-rules for a test server.
            ...(process.env.E2E_CHROMIUM_ARGS ? (JSON.parse(process.env.E2E_CHROMIUM_ARGS) as string[]) : []),
          ],
        },
      },
    },
    // Browser matrix: the recording flow and the live call in every engine.
    {
      name: "firefox",
      testMatch: ENGINES,
      use: {
        ...devices["Desktop Firefox"],
        permissions: [], // Firefox takes camera/mic permission from the prefs below
        launchOptions: {
          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
            "media.volume_scale": "0.0", // silent speakers; the tests measure the streams themselves
            // The test LiveKit listens on 127.0.0.1, and Firefox skips loopback ICE candidates
            // by default (real servers aren't on loopback, so this is only for tests).
            "media.peerconnection.ice.loopback": true,
            "media.peerconnection.ice.obfuscate_host_addresses": false,
            "media.peerconnection.ice.default_address_only": false,
          },
        },
      },
    },
    {
      name: "webkit",
      testMatch: ENGINES,
      use: { ...devices["Desktop Safari"] }, // WebKit uses mock camera/mic devices
    },
    {
      // Safari before 18.4 and iOS record MP4 only: hide WebM to take that path.
      name: "webkit-mp4",
      testMatch: MATRIX,
      use: { ...devices["Desktop Safari"], forceMp4: true },
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
      // Transcripts only when a model is given; empty keeps .env.local's settings out.
      WHISPER_PATH: process.env.WHISPER_PATH ?? "whisper-cli",
      WHISPER_MODEL: process.env.WHISPER_MODEL ?? "",
      WHISPER_VAD_MODEL: process.env.WHISPER_VAD_MODEL ?? "",
      // Live call when scripts/with-seaweedfs.mjs started LiveKit (LIVEKIT_BIN set); otherwise
      // explicitly off, so a LIVEKIT_URL in .env.local (which next dev also reads) can't leak in.
      LIVEKIT_URL: process.env.LIVEKIT_E2E_URL ?? "",
      LIVEKIT_API_KEY: process.env.LIVEKIT_E2E_API_KEY ?? "",
      LIVEKIT_API_SECRET: process.env.LIVEKIT_E2E_API_SECRET ?? "",
    },
  },
});
