import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Storage } from "./storage";

/** Write, read back and delete a small object. Never throws; the error is a short reason (no data). */
export async function probeStorage(storage: Storage): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const key = `health/check-${randomBytes(6).toString("hex")}.txt`;
  const dir = await mkdtemp(join(tmpdir(), "tapry-health-"));
  const t0 = performance.now();
  try {
    const path = join(dir, "check.txt");
    await writeFile(path, "tapry health check\n");
    await storage.uploadFrom(key, path, "text/plain");
    const found = await storage.head(key);
    await storage.delete([key]);
    if (!found) throw new Error("The test file wasn't there after writing it");
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
