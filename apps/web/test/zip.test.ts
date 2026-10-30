import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { expectOk, FakeStorage, setup } from "./harness";

// Python's zipfile reads ZIP64 and UTF-8 names correctly, so it checks the archive independently.
const hasPython = (() => {
  try {
    execFileSync("python3", ["-c", "import zipfile"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Names, sizes and contents of a zip, as Python's zipfile reads them (after testzip() passes). */
function readZip(data: Buffer): Array<{ name: string; size: number; text: string }> {
  const file = join(mkdtempSync(join(tmpdir(), "opentake-zip-")), "x.zip");
  writeFileSync(file, data);
  const script = `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, "bad CRC"
print(json.dumps([{"name": i.filename, "size": i.file_size, "text": z.read(i).decode("utf-8", "replace")} for i in z.infolist()]))`;
  return JSON.parse(execFileSync("python3", ["-I", "-c", script, file]).toString());
}

describe("zip download", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
    await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
  });

  const zipPath = `/studios/STUDIO/recordings/REC/zip`;
  const url = () => `https://app.test/api${zipPath.replace("STUDIO", t.studio.id).replace("REC", t.recordingId)}`;
  const download = (cookie = [...t.hostBrowser.jar].map(([k, v]) => `${k}=${v}`).join("; ")) =>
    t.fetchFor()(url(), { headers: { host: "app.test", cookie } });

  async function addOutput(id: string, kind: string, fileName: string, content: string) {
    const key = `outputs/${t.sessionId}/${t.recordingId}/${id}`;
    storage.put(key, content);
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes)
       VALUES ($1, $2, $3, $4, 'application/octet-stream', $5, $6)`,
      [id, t.recordingId, kind, fileName, key, Buffer.byteLength(content)],
    );
  }

  async function processed() {
    await addOutput("out_a", "audio", "Zoë - audio.wav", "RIFF audio of Zoë");
    await addOutput("out_c", "combined", "Combined.mp4", "combined video bytes");
    await addOutput("out_t", "transcript", "Transcript.txt", "[00:00] Zoë: hello");
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
  }

  it.skipIf(!hasPython)("streams every file of the recording into one valid zip, byte for byte", async () => {
    await processed();
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="My Podcast - \d{4}-\d\d-\d\d \d\d\.\d\d UTC\.zip"/);
    const body = Buffer.from(await res.arrayBuffer());
    // The announced length is exact, so browsers show real progress.
    expect(Number(res.headers.get("content-length"))).toBe(body.length);

    expect(readZip(body)).toEqual([
      { name: "Combined.mp4", size: 20, text: "combined video bytes" },
      { name: "Zoë - audio.wav", size: 18, text: "RIFF audio of Zoë" },
      { name: "Transcript.txt", size: 19, text: "[00:00] Zoë: hello" },
    ]);
    expect(storage.reads).toHaveLength(3);
  });

  it("is refused until the recording has been processed", async () => {
    const res = await download();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_ready");
  });

  it("keeps people who aren't the host out, and deleted recordings gone", async () => {
    await processed();
    expect((await download("")).status).toBe(401);
    await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`));
    expect((await download()).status).toBe(404);
  });

  // A real recording's video easily passes 4 GB, the classic zip limit. Streams 4.3 GB of
  // generated data through the zip writer (no memory or disk), so it takes a while: SLOW_TESTS=1.
  it.skipIf(!process.env.SLOW_TESTS)("handles files over 4 GB (ZIP64)", { timeout: 300_000 }, async () => {
    const size = Math.round(4.3 * 1024 ** 3);
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes)
       VALUES ('out_big', $1, 'combined', 'Combined.mp4', 'video/mp4', 'big', $2)`,
      [t.recordingId, size],
    );
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
    const block = new Uint8Array(8 * 1024 * 1024);
    storage.openRead = async () => {
      let left = size;
      return new ReadableStream<Uint8Array>({
        pull(c) {
          const n = Math.min(block.length, left);
          left -= n;
          c.enqueue(n === block.length ? block : block.subarray(0, n));
          if (left === 0) c.close();
        },
      });
    };

    const res = await download();
    let total = 0;
    let tail = Buffer.alloc(0);
    const reader = res.body!.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      total += r.value.length;
      tail = Buffer.concat([tail, Buffer.from(r.value)]).subarray(-200);
    }
    expect(total).toBe(Number(res.headers.get("content-length")));
    expect(total).toBeGreaterThan(size);
    // The ZIP64 end-of-central-directory record is there (signature PK\x06\x06).
    expect(tail.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
  });
});
