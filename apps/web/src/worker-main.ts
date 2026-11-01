// Standalone worker: processes and transcribes recordings, separately from the web server.
// Run as many as you like against one Postgres (jobs are claimed with SKIP LOCKED); the web
// server then runs with WORKER=off and only queues jobs. Bundled to dist-worker/worker.cjs.
import { writeFileSync } from "node:fs";
import { loadConfig } from "./server/config";
import { openDb } from "./server/db";
import { JobRunner } from "./server/jobs";
import { S3Storage } from "./server/storage";

const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/tapry-worker-heartbeat";

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl?.startsWith("postgres")) {
    throw new Error(
      "The standalone worker needs Postgres (DATABASE_URL=postgres://…): the embedded database " +
        "only works inside one process. Without Postgres, run the web server with WORKER=inprocess.",
    );
  }
  const storage = new S3Storage(config.storage);
  await storage.ensureBucket();
  const db = await openDb(config.databaseUrl);

  const runner = new JobRunner(db, storage, {
    ...config.worker,
    // Proof of life for the container health check: written after every poll.
    onPoll: () => writeFileSync(HEARTBEAT_FILE, String(Date.now())),
  });
  runner.start();
  console.log(
    `[worker] started: polling every ${config.worker.pollMs} ms, transcripts ${config.worker.whisper ? "on" : "off"}`,
  );

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    // Hand a running job back so another worker starts it now, rather than after the lock expires.
    const released = await runner.shutdown().catch((err) => {
      console.error("[worker] could not release the running job", err);
      return null;
    });
    console.log(`[worker] ${signal}: stopping${released ? `, handed ${released} back to the queue` : ""}`);
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
