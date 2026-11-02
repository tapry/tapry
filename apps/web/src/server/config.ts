// Environment → typed configuration, shared by the web server (context.ts) and the
// standalone worker (worker-main.ts), so both read the same variables the same way.
import { z } from "zod";
import type { CallConfig } from "./call";
import type { S3StorageConfig } from "./storage";

/** An empty variable (`LIVEKIT_URL=` in a compose file) means "not set". */
function unsetIfEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

const bool = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const env = z.object({
  DATABASE_URL: z.string().optional(),
  ALLOW_SIGNUP: bool("false"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool("true"),
  /** "inprocess" (default): the web server also processes recordings. "off": a separate worker does. */
  WORKER: z.enum(["inprocess", "off"]).default("inprocess"),
  /** How often an idle worker looks for jobs. */
  WORKER_POLL_MS: z.coerce.number().int().min(200).max(60_000).default(2000),
  /** A crashed worker's job is picked up again after this long (running jobs renew it). */
  WORKER_LOCK_SECONDS: z.coerce.number().int().min(10).max(86_400).default(600),
  /**
   * Delete each episode's original uploads this many days after its files are ready (0: right
   * away). The processed files stay. Unset (default): keep the originals.
   */
  RAW_RETENTION_DAYS: unsetIfEmpty(z.coerce.number().min(0).max(3650)),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  /** Transcripts: set WHISPER_MODEL (a whisper.cpp ggml model file) to turn them on. */
  WHISPER_PATH: z.string().default("whisper-cli"),
  WHISPER_MODEL: unsetIfEmpty(z.string()),
  WHISPER_VAD_MODEL: unsetIfEmpty(z.string()),
  WHISPER_THREADS: z.coerce.number().int().min(1).max(64).default(4),
  /** Font for names on the combined video's tiles; found automatically when unset. */
  TILE_FONT: unsetIfEmpty(z.string()),
  /** Guests' end screen links here ("Record your own, free"). Unset (default): no such link. */
  GUEST_PROMO_URL: unsetIfEmpty(z.string().url()),
  /** Live call. All three set: call on. LIVEKIT_URL unset: recording works without a call. */
  LIVEKIT_URL: unsetIfEmpty(z.string().url()),
  LIVEKIT_API_KEY: unsetIfEmpty(z.string()),
  LIVEKIT_API_SECRET: unsetIfEmpty(z.string()),
});

export interface WorkerConfig {
  ffmpeg: string;
  ffprobe: string;
  whisper?: { whisper: string; model: string; vadModel?: string; threads: number };
  font?: string;
  pollMs: number;
  lockMs: number;
  /** Delete originals this long after processing; undefined keeps them. */
  rawRetentionMs?: number;
}

export interface Config {
  databaseUrl: string | undefined;
  allowSignup: boolean;
  storage: S3StorageConfig;
  /** How recordings get processed; `inProcess` false when a separate worker does it. */
  worker: WorkerConfig & { inProcess: boolean };
  call: CallConfig | null;
  guestPromoUrl: string | null;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = env.safeParse(source);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration (${bad}). See apps/web/.env.example`);
  }
  const cfg = parsed.data;
  if (cfg.LIVEKIT_URL && !(cfg.LIVEKIT_API_KEY && cfg.LIVEKIT_API_SECRET)) {
    throw new Error("LIVEKIT_URL is set but LIVEKIT_API_KEY / LIVEKIT_API_SECRET are missing");
  }
  return {
    databaseUrl: cfg.DATABASE_URL,
    allowSignup: cfg.ALLOW_SIGNUP,
    storage: {
      endpoint: cfg.S3_ENDPOINT,
      publicEndpoint: cfg.S3_PUBLIC_ENDPOINT,
      region: cfg.S3_REGION,
      bucket: cfg.S3_BUCKET,
      accessKeyId: cfg.S3_ACCESS_KEY_ID,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    },
    worker: {
      inProcess: cfg.WORKER === "inprocess",
      ffmpeg: cfg.FFMPEG_PATH,
      ffprobe: cfg.FFPROBE_PATH,
      whisper: cfg.WHISPER_MODEL
        ? { whisper: cfg.WHISPER_PATH, model: cfg.WHISPER_MODEL, vadModel: cfg.WHISPER_VAD_MODEL, threads: cfg.WHISPER_THREADS }
        : undefined,
      font: cfg.TILE_FONT,
      pollMs: cfg.WORKER_POLL_MS,
      lockMs: cfg.WORKER_LOCK_SECONDS * 1000,
      rawRetentionMs: cfg.RAW_RETENTION_DAYS === undefined ? undefined : cfg.RAW_RETENTION_DAYS * 86_400_000,
    },
    call: cfg.LIVEKIT_URL ? { url: cfg.LIVEKIT_URL, apiKey: cfg.LIVEKIT_API_KEY!, apiSecret: cfg.LIVEKIT_API_SECRET! } : null,
    guestPromoUrl: cfg.GUEST_PROMO_URL ?? null,
  };
}
