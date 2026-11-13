// What a job runner can do, for the admin health page: its tools' versions and its scratch
// space. Gathered by the runner itself, so a separate worker container reports its own.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { tmpdir } from "node:os";

export interface WorkerInfo {
  /** First line of `ffmpeg -version`, or null when it can't be run. */
  ffmpeg: string | null;
  ffprobe: string | null;
  /** Transcription, when configured: the model file and whether it's there. */
  whisper: { model: string; modelFound: boolean } | null;
  /** Free space where jobs work (recordings are unpacked there). Null when unknown. */
  tmpFreeBytes: number | null;
}

/** The version this build reports (set by the release images). */
export const APP_VERSION = process.env.TAPRY_VERSION ?? "dev";

function versionLine(bin: string) {
  return new Promise<string | null>((resolve) => {
    execFile(bin, ["-version"], { timeout: 10_000 }, (err, stdout) => resolve(err ? null : (stdout.split("\n")[0]?.trim() ?? null)));
  });
}

export async function freeBytes(dir = tmpdir()) {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

export async function gatherWorkerInfo(opts: { ffmpeg: string; ffprobe: string; whisper?: { model: string } }): Promise<WorkerInfo> {
  const [ffmpeg, ffprobe, tmpFreeBytes] = await Promise.all([versionLine(opts.ffmpeg), versionLine(opts.ffprobe), freeBytes()]);
  return {
    ffmpeg,
    ffprobe,
    whisper: opts.whisper ? { model: opts.whisper.model, modelFound: existsSync(opts.whisper.model) } : null,
    tmpFreeBytes,
  };
}
