import { createApiHandlers } from "./api";
import { loadConfig, type Config } from "./config";
import { migrate, openDb, type Db } from "./db";
import { JobRunner } from "./jobs";
import { LiveHub } from "./live";
import { SmtpMailer } from "./mail";
import { createServices, type Services } from "./services";
import { S3Storage } from "./storage";

/**
 * What must exist once per process lives on globalThis: the database connection (PGlite
 * can't open the same folder twice) and the live-update hub (subscribers must be visible
 * to every route). `next dev` re-evaluates server modules each time it compiles a route
 * or you edit a file, so module variables would get a second copy of each.
 *
 * The services (and the storage client, which holds no state) are rebuilt from the current
 * code on every module evaluation, so edits to server code take effect without restarting.
 */
interface Shared {
  resources?: Promise<{ db: Db; config: Config }>;
  hub?: LiveHub;
  runner?: JobRunner;
}

const shared = ((globalThis as typeof globalThis & { __tapry?: Shared }).__tapry ??= {});

let services: Promise<Services> | undefined;

/** Services for this module evaluation, on top of the process-wide resources. */
export function getServices(): Promise<Services> {
  return (services ??= resources().then(async ({ db, config }) => {
    const storage = new S3Storage(config.storage);
    // The connection outlives code edits in dev; a pulled or new migration applies on the next reload.
    await migrate(db);
    const mailer = config.mail && new SmtpMailer(config.mail.smtp);
    const svc = createServices(db, storage, {
      auth: { allowSignup: config.allowSignup, setupToken: config.setupToken },
      hub: (shared.hub ??= new LiveHub()),
      call: config.call,
      guestPromoUrl: config.guestPromoUrl,
      mailer,
      speedTestOrigins: config.speedTestOrigins,
      health: { updateRepo: config.updateRepo, inProcess: config.worker.inProcess },
      serverInfo: {
        storage: { endpoint: config.storage.endpoint ?? null, region: config.storage.region, bucket: config.storage.bucket, accessKeyId: config.storage.accessKeyId },
        rawRetentionDays: config.worker.rawRetentionMs === undefined ? null : config.worker.rawRetentionMs / 86_400_000,
        whisperModel: config.worker.whisper?.model ?? null,
        emailOn: !!config.mail,
        updateRepo: config.updateRepo,
        setupTokenSet: !!config.setupToken,
        allowSignup: config.allowSignup,
        callOn: !!config.call,
      },
    });
    if (config.worker.inProcess) {
      // Replace the runner too, so worker code edits apply. The old one finishes its current job.
      shared.runner?.stop();
      const runner = new JobRunner(db, storage, {
        ...config.worker,
        kind: "inprocess",
        mail: mailer && { mailer, appUrl: config.mail!.appUrl, promoUrl: config.guestPromoUrl },
        onChange: (sessionId) => svc.live.publishSoon(sessionId),
      });
      svc.processing.onEnqueue = () => runner.kick();
      shared.runner = runner;
      // Be on record before the first page asks (the health page would say no worker runs).
      await runner.heartbeat();
      runner.start();
    }
    // Otherwise a separate worker (worker-main.ts) polls the jobs table.
    return svc;
  }).catch((err) => {
    services = undefined; // retry on the next request
    throw err;
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
  const config = loadConfig();
  await new S3Storage(config.storage).ensureBucket();
  return { db: await openDb(config.databaseUrl), config };
}

export const api = createApiHandlers(getServices);
