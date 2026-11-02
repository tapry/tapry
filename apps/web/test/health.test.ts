import { describe, expect, it } from "vitest";
import { compareVersions, HealthService, type HealthCheck } from "../src/server/health";
import { JobRunner } from "../src/server/jobs";
import { APP_VERSION } from "../src/server/worker-info";
import { createServer, FakeStorage, setup } from "./harness";

const check = (checks: HealthCheck[], id: HealthCheck["id"]) => checks.find((c) => c.id === id)!;

async function server() {
  const storage = new FakeStorage();
  const s = await createServer(storage);
  const worker = (info: Partial<{ ffmpeg: string | null; ffprobe: string | null; whisper: { model: string; modelFound: boolean } | null; tmpFreeBytes: number | null }> = {}, opts: { version?: string; seenAgo?: string } = {}) =>
    s.db.query(
      `INSERT INTO workers (id, kind, version, info, seen_at) VALUES ($1, 'worker', $2, $3, now() - $4::interval)`,
      [
        `wrk_${Math.random().toString(36).slice(2)}`,
        opts.version ?? APP_VERSION,
        JSON.stringify({ ffmpeg: "ffmpeg version 7.1", ffprobe: "ffprobe version 7.1", whisper: null, tmpFreeBytes: 50 * 1024 ** 3, ...info }),
        opts.seenAgo ?? "5 seconds",
      ],
    );
  return { ...s, storage, worker };
}

describe("admin health checks", () => {
  it("finds database and storage working (storage by writing, reading and deleting a file)", async () => {
    const s = await server();
    const { checks } = await s.services.health.report();
    expect(check(checks, "database")).toMatchObject({ tone: "ok", summary: expect.stringMatching(/^Answering in \d+ ms$/) });
    expect(check(checks, "storage")).toMatchObject({ tone: "ok" });
    expect([...s.storage.objects.keys()].filter((k) => k.startsWith("health/"))).toEqual([]); // cleaned up
  });

  it("says when storage can't be written", async () => {
    const s = await server();
    s.storage.uploadFrom = async () => {
      throw new Error("AccessDenied");
    };
    const { checks } = await s.services.health.report();
    expect(check(checks, "storage")).toMatchObject({ tone: "danger", details: [expect.stringContaining("AccessDenied"), expect.any(String)] });
  });

  it("knows whether a worker is running, from their heartbeats", async () => {
    const s = await server();
    expect(check((await s.services.health.report()).checks, "workers")).toMatchObject({ tone: "danger", summary: expect.stringMatching(/No worker is running/) });

    // A real runner's heartbeat, with its real tools (whatever this machine has).
    const runner = new JobRunner(s.db, s.storage, { ffmpeg: process.env.FFMPEG_PATH ?? "ffmpeg", ffprobe: process.env.FFPROBE_PATH ?? "ffprobe", kind: "inprocess" });
    await runner.heartbeat();
    const { workers } = await s.services.health.report();
    expect(workers).toEqual([expect.objectContaining({ id: runner.id, kind: "inprocess", version: APP_VERSION })]);
    expect(workers[0]!.info.tmpFreeBytes).toBeGreaterThan(0);

    // One that stopped beating a while ago doesn't count.
    await s.db.query("UPDATE workers SET seen_at = now() - interval '10 minutes'");
    const gone = check((await s.services.health.report()).checks, "workers");
    expect(gone).toMatchObject({ tone: "danger", details: [expect.stringMatching(/Last seen \d+ min ago/), expect.any(String)] });
  });

  it("flags a worker that can't run ffmpeg, or runs another version", async () => {
    const s = await server();
    await s.worker({ ffmpeg: null });
    expect(check((await s.services.health.report()).checks, "workers")).toMatchObject({ tone: "danger", summary: expect.stringMatching(/can't run ffmpeg/) });
    const t = await server();
    await t.worker({}, { version: "0.0.1" });
    expect(check((await t.services.health.report()).checks, "workers")).toMatchObject({ tone: "warn", summary: expect.stringMatching(/runs version 0\.0\.1/) });
  });

  it("reports failed jobs with their reason, and a missing transcript model", async () => {
    const t = await setup();
    await t.db.query(
      `INSERT INTO jobs (id, type, recording_id, status, error, finished_at) VALUES ('job_f', 'process_recording', $1, 'failed', 'ffmpeg exited 1: Invalid data', now())`,
      [t.recordingId],
    );
    await t.db.query(
      `INSERT INTO workers (id, kind, version, info) VALUES ('wrk_w', 'worker', $1, $2)`,
      [APP_VERSION, JSON.stringify({ ffmpeg: "ffmpeg 7", ffprobe: "ffprobe 7", whisper: { model: "/models/ggml-base.bin", modelFound: false }, tmpFreeBytes: 2 * 1024 ** 3 })],
    );
    const report = await t.services.health.report();
    expect(check(report.checks, "queue")).toMatchObject({ tone: "warn", summary: "1 job failed in the last day (below)" });
    expect(report.failures).toEqual([expect.objectContaining({ type: "process_recording", recordingId: t.recordingId, error: "ffmpeg exited 1: Invalid data" })]);
    expect(check(report.checks, "transcripts")).toMatchObject({ tone: "danger", details: ["Not found: /models/ggml-base.bin"] });
    expect(check(report.checks, "disk")).toMatchObject({ tone: "warn", summary: expect.stringMatching(/^Only 2\.0 GB free/) });
  });

  it("checks the live call and, only when asked to, for a newer release", async () => {
    const s = await server();
    expect(check((await s.services.health.report()).checks, "call").tone).toBe("off");
    expect(check((await s.services.health.report()).checks, "version").details[0]).toMatch(/Update check off/);

    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith("http://livekit.test")) return new Response("OK");
      return Response.json({ tag_name: "v99.0.0" });
    }) as typeof fetch;
    const health = new HealthService(s.db, s.storage, {
      call: { url: "ws://livekit.test:7880", apiKey: "k", apiSecret: "s" },
      updateRepo: "tapry/tapry",
      fetch: fakeFetch,
      version: "0.2.0",
    });
    const { checks } = await health.report();
    expect(check(checks, "call")).toMatchObject({ tone: "ok", summary: expect.stringMatching(/LiveKit answering/) });
    expect(check(checks, "version")).toMatchObject({ tone: "warn", summary: "0.2.0: version 99.0.0 is out" });
    expect(calls).toContain("https://api.github.com/repos/tapry/tapry/releases/latest");

    const down = new HealthService(s.db, s.storage, {
      call: { url: "ws://livekit.test:7880", apiKey: "k", apiSecret: "s" },
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(check((await down.report()).checks, "call")).toMatchObject({ tone: "danger", summary: expect.stringMatching(/isn't answering/) });
  });

  it("compares versions part by part", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.1", "0.2")).toBeLessThan(0);
  });

  it("is for the admin only", async () => {
    const t = await setup();
    expect((await t.hostBrowser.get("/admin/health")).status).toBe(200);
    expect((await t.client().get("/admin/health")).status).toBe(401);
  });
});
