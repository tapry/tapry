import { z } from "zod";
import { createApiHandlers } from "./api";
import type { CallConfig } from "./call";
import { openDb, type Db } from "./db";
import { JobRunner } from "./jobs";
import { LiveHub } from "./live";
import { createServices, type Services } from "./services";
import { S3Storage } from "./storage";

/** An empty variable (`LIVEKIT_URL=` in a compose file) means "not set". */
function unsetIfEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

const env = z.object({
  DATABASE_URL: z.string().optional(),
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /** "inprocess" (default): the web server also processes recordings. "off": a separate worker does. */
  WORKER: z.enum(["inprocess", "off"]).default("inprocess"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  /** Live call. All three set: call on. LIVEKIT_URL unset: recording works without a call. */
  LIVEKIT_URL: unsetIfEmpty(z.string().url()),
  LIVEKIT_API_KEY: unsetIfEmpty(z.string()),
  LIVEKIT_API_SECRET: unsetIfEmpty(z.string()),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

/**
 * What must exist once per process lives on globalThis: the database connection (PGlite
 * can't open the same folder twice) and the live-update hub (subscribers must be visible
 * to every route). `next dev` re-evaluates server modules each time it compiles a route
 * or you edit a file, so module variables would get a second copy of each.
 *
 * The services themselves are rebuilt from the current code on every module evaluation,
 * so edits to server code take effect without restarting the dev server.
 */
interface Shared {
  resources?: Promise<{ db: Db; storage: S3Storage; allowSignup: boolean; worker: WorkerConfig | null; call: CallConfig | null }>;
  hub?: LiveHub;
  runner?: JobRunner;
}

interface WorkerConfig {
  ffmpeg: string;
  ffprobe: string;
}
const shared = ((globalThis as typeof globalThis & { __opentake?: Shared }).__opentake ??= {});

let services: Promise<Services> | undefined;

/** Services for this module evaluation, on top of the process-wide resources. */
export function getServices(): Promise<Services> {
  return (services ??= resources().then(({ db, storage, allowSignup, worker, call }) => {
    const svc = createServices(db, storage, { auth: { allowSignup }, hub: (shared.hub ??= new LiveHub()), call });
    if (worker) {
      // Replace the runner too, so worker code edits apply. The old one finishes its current job.
      shared.runner?.stop();
      const runner = new JobRunner(db, storage, { ...worker, onChange: (sessionId) => svc.live.publishSoon(sessionId) });
      svc.processing.onEnqueue = () => runner.kick();
      shared.runner = runner;
      runner.start();
    }
    return svc;
  }));
}

function resources(): NonNullable<Shared["resources"]> {
  return (shared.resources ??= openResources().catch((err) => {
    shared.resources = undefined; // let the next request retry instead of caching the failure
    services = undefined;
    throw err;
  }));
}

async function openResources() {
  const parsed = env.safeParse(process.env);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration (${bad}). See apps/web/.env.example`);
  }
  const cfg = parsed.data;
  const storage = new S3Storage({
    endpoint: cfg.S3_ENDPOINT,
    publicEndpoint: cfg.S3_PUBLIC_ENDPOINT,
    region: cfg.S3_REGION,
    bucket: cfg.S3_BUCKET,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  await storage.ensureBucket();
  const worker = cfg.WORKER === "inprocess" ? { ffmpeg: cfg.FFMPEG_PATH, ffprobe: cfg.FFPROBE_PATH } : null;
  if (cfg.LIVEKIT_URL && !(cfg.LIVEKIT_API_KEY && cfg.LIVEKIT_API_SECRET)) {
    throw new Error("LIVEKIT_URL is set but LIVEKIT_API_KEY / LIVEKIT_API_SECRET are missing");
  }
  const call = cfg.LIVEKIT_URL
    ? { url: cfg.LIVEKIT_URL, apiKey: cfg.LIVEKIT_API_KEY!, apiSecret: cfg.LIVEKIT_API_SECRET! }
    : null;
  return { db: await openDb(cfg.DATABASE_URL), storage, allowSignup: cfg.ALLOW_SIGNUP, worker, call };
}

export const api = createApiHandlers(getServices);
