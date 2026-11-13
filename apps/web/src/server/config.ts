// Environment → typed configuration, shared by the web server (context.ts) and the
// standalone worker (worker-main.ts), so both read the same variables the same way.
import { z } from "zod";
import { planId, type PlanId } from "@tapry/shared";
import type { PaddleCheckoutConfig } from "./billing";
import type { WebhookConfig } from "./billing-webhooks";
import type { CallConfig } from "./call";
import type { SmtpConfig } from "./mail";
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
  /** The first account must enter this (setup.sh generates one), so a stranger can't claim a new install. */
  SETUP_TOKEN: unsetIfEmpty(z.string().min(8)),
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
   * Delete each recording's original uploads this many days after its files are ready (0: right
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
  /** GitHub repo ("owner/name") whose latest release the admin health page compares with. Unset: no check. */
  UPDATE_CHECK_REPO: unsetIfEmpty(z.string().regex(/^[\w.-]+\/[\w.-]+$/)),
  /** Other sites (comma-separated origins) whose pages may use this server's public upload-speed test. */
  SPEED_TEST_ORIGINS: z.string().default(""),
  /** Guests' end screen links here ("Record your own, free"). Unset (default): no such link. */
  GUEST_PROMO_URL: unsetIfEmpty(z.string().url()),
  /** This server's public address, for links in email. Needed with SMTP_HOST. */
  APP_URL: unsetIfEmpty(z.string().url()),
  /** Email (guests' recap). SMTP_HOST set: on. Unset (default): nothing is ever emailed. */
  SMTP_HOST: unsetIfEmpty(z.string()),
  SMTP_PORT: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(65535).default(587)),
  SMTP_USER: unsetIfEmpty(z.string()),
  SMTP_PASSWORD: unsetIfEmpty(z.string()),
  /** Who the email is from: "Studio <studio@example.com>". Needed with SMTP_HOST. */
  SMTP_FROM: unsetIfEmpty(z.string()),
  /** Allow an unencrypted connection (a mail server on this machine or private network). */
  SMTP_INSECURE: bool("false"),
  /** Live call. All three set: call on. LIVEKIT_URL unset: recording works without a call. */
  LIVEKIT_URL: unsetIfEmpty(z.string().url()),
  LIVEKIT_API_KEY: unsetIfEmpty(z.string()),
  LIVEKIT_API_SECRET: unsetIfEmpty(z.string()),
  /**
   * Lets accounts record into their own S3-compatible bucket: their secret keys are stored
   * encrypted with this. Unset (default): own storage is off. Changing it makes saved keys unreadable.
   */
  STORAGE_SECRET_KEY: unsetIfEmpty(z.string().min(16)),
  /** Accept private and plain-HTTP endpoints for own storage (a trusted install on a private network). */
  OWN_STORAGE_ALLOW_PRIVATE: bool("false"),
  /**
   * Run this server as Tapry Cloud: accounts have plans with recording hours and file
   * retention (packages/shared PLANS). False (default, every self-hosted server): no plans, no limits.
   */
  TAPRY_CLOUD: bool("false"),
  /** Who sells the subscriptions. With BILLING_WEBHOOK_SECRET set, POST /api/billing/webhook is on. */
  BILLING_PROVIDER: z.enum(["paddle", "lemonsqueezy"]).default("paddle"),
  BILLING_WEBHOOK_SECRET: unsetIfEmpty(z.string().min(8)),
  /**
   * The provider's price ids and the plan each sells, a yearly price marked ":yearly":
   * "pri_abc=creator,pri_def=creator:yearly,pri_xyz=studio".
   */
  BILLING_PRICES: z.string().default(""),
  /** Checkout addresses per plan: "creator=https://…{user_id}…{email},studio=https://…". A plan without one isn't offered. */
  BILLING_CHECKOUT_URLS: z.string().default(""),
  /** The provider's customer portal (card, invoices, cancelling). */
  BILLING_MANAGE_URL: unsetIfEmpty(z.string().url()),
  /**
   * Paddle's client-side token: with it, plans with a price in BILLING_PRICES are bought on this
   * server's own checkout page (/checkout/<plan>), which opens Paddle's checkout.
   */
  BILLING_PADDLE_CLIENT_TOKEN: unsetIfEmpty(z.string().min(8)),
  /**
   * Paddle's API key, for customer portal sessions (Settings, Plan: card, invoices, cancelling).
   * A secret: server-side only. Unset: the portal falls back to BILLING_MANAGE_URL, if any.
   */
  BILLING_PADDLE_API_KEY: unsetIfEmpty(z.string().min(10)),
  /** Use Paddle's sandbox (test payments) instead of live. */
  BILLING_PADDLE_SANDBOX: bool("false"),
});

/** "a=b,c=d" → pairs; the value may itself hold "=" (an address with a query). */
function pairs(value: string, name: string): Array<[string, string]> {
  return value.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const at = p.indexOf("=");
    if (at < 1 || at === p.length - 1) throw new Error(`${name}: "${p}" is not key=value`);
    return [p.slice(0, at).trim(), p.slice(at + 1).trim()];
  });
}

/** "creator" or "creator:yearly" → the plan and whether the price is the yearly one. */
function planPrice(value: string, name: string): { plan: PlanId; yearly: boolean } {
  const yearly = value.endsWith(":yearly");
  return { plan: plan(yearly ? value.slice(0, -":yearly".length) : value, name), yearly };
}

function plan(value: string, name: string): PlanId {
  const parsed = planId.safeParse(value);
  if (!parsed.success) throw new Error(`${name}: "${value}" is not a plan`);
  return parsed.data;
}

export interface WorkerConfig {
  ffmpeg: string;
  ffprobe: string;
  whisper?: { whisper: string; model: string; vadModel?: string; threads: number };
  font?: string;
  pollMs: number;
  lockMs: number;
  /** Delete originals this long after processing; undefined keeps them. */
  rawRetentionMs?: number;
  /** Tapry Cloud: retention follows each host's plan instead of rawRetentionMs. */
  cloud?: boolean;
}

export interface Config {
  databaseUrl: string | undefined;
  allowSignup: boolean;
  setupToken: string | null;
  storage: S3StorageConfig;
  /** How recordings get processed; `inProcess` false when a separate worker does it. */
  worker: WorkerConfig & { inProcess: boolean };
  call: CallConfig | null;
  guestPromoUrl: string | null;
  mail: { smtp: SmtpConfig; appUrl: string } | null;
  speedTestOrigins: string[];
  updateRepo: string | null;
  /** Accounts' own buckets: the key their secrets are encrypted with (null: off). */
  ownStorage: { serverKey: string | null; allowPrivate: boolean };
  /** Tapry Cloud: plans, limits and billing. Null on a self-hosted server. */
  cloud: {
    checkoutUrls: Partial<Record<PlanId, string>>;
    manageUrl: string | null;
    webhook: WebhookConfig | null;
    /** Paddle's checkout on this server's own page; null without a client token. */
    paddle: PaddleCheckoutConfig | null;
    /** Paddle's API key (portal sessions); null when unset. */
    paddleApiKey: string | null;
    paddleSandbox: boolean;
  } | null;
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
  if (cfg.SMTP_HOST && !(cfg.SMTP_FROM && cfg.APP_URL)) {
    throw new Error("SMTP_HOST is set but SMTP_FROM / APP_URL are missing");
  }
  return {
    databaseUrl: cfg.DATABASE_URL,
    allowSignup: cfg.ALLOW_SIGNUP,
    setupToken: cfg.SETUP_TOKEN ?? null,
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
      cloud: cfg.TAPRY_CLOUD,
    },
    call: cfg.LIVEKIT_URL ? { url: cfg.LIVEKIT_URL, apiKey: cfg.LIVEKIT_API_KEY!, apiSecret: cfg.LIVEKIT_API_SECRET! } : null,
    guestPromoUrl: cfg.GUEST_PROMO_URL ?? null,
    mail: cfg.SMTP_HOST
      ? {
          smtp: { host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, user: cfg.SMTP_USER, password: cfg.SMTP_PASSWORD, from: cfg.SMTP_FROM!, insecure: cfg.SMTP_INSECURE },
          appUrl: cfg.APP_URL!,
        }
      : null,
    speedTestOrigins: cfg.SPEED_TEST_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    updateRepo: cfg.UPDATE_CHECK_REPO ?? null,
    ownStorage: { serverKey: cfg.STORAGE_SECRET_KEY ?? null, allowPrivate: cfg.OWN_STORAGE_ALLOW_PRIVATE },
    cloud: cfg.TAPRY_CLOUD
      ? ((prices) => ({
          // Read even without a webhook secret, so a mistyped plan is caught at start.
          checkoutUrls: Object.fromEntries(pairs(cfg.BILLING_CHECKOUT_URLS, "BILLING_CHECKOUT_URLS").map(([k, v]) => [plan(k, "BILLING_CHECKOUT_URLS"), v])),
          manageUrl: cfg.BILLING_MANAGE_URL ?? null,
          webhook: cfg.BILLING_WEBHOOK_SECRET
            ? { provider: cfg.BILLING_PROVIDER, secret: cfg.BILLING_WEBHOOK_SECRET, prices: Object.fromEntries(prices.map(([id, p]) => [id, p.plan])) }
            : null,
          paddle:
            cfg.BILLING_PROVIDER === "paddle" && cfg.BILLING_PADDLE_CLIENT_TOKEN
              ? {
                  clientToken: cfg.BILLING_PADDLE_CLIENT_TOKEN,
                  sandbox: cfg.BILLING_PADDLE_SANDBOX,
                  prices: prices.reduce<PaddleCheckoutConfig["prices"]>((all, [id, p]) => ({ ...all, [p.plan]: { ...all[p.plan], [p.yearly ? "yearly" : "monthly"]: id } }), {}),
                }
              : null,
          paddleApiKey: cfg.BILLING_PADDLE_API_KEY ?? null,
          paddleSandbox: cfg.BILLING_PADDLE_SANDBOX,
        }))(pairs(cfg.BILLING_PRICES, "BILLING_PRICES").map(([k, v]) => [k, planPrice(v, "BILLING_PRICES")] as const))
      : null,
  };
}
