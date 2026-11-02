import { spawn } from "node:child_process";
export class FfmpegError extends Error {
    stderrTail;
    constructor(message, stderrTail) {
        super(message);
        this.stderrTail = stderrTail;
    }
}
/**
 * Run a binary; resolves with stdout on exit 0 (or the end of stderr, with `stderr: true`:
 * ffmpeg's filters report measurements there), rejects with the end of stderr otherwise.
 */
export function run(bin, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        // Keep only the tail: ffmpeg is chatty and only the last lines explain a failure.
        child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
        const timer = opts.timeoutMs
            ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
            : undefined;
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(new FfmpegError(`Could not run ${bin}: ${err.message}`, ""));
        });
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            if (code === 0)
                resolve(opts.stderr ? stderr : stdout);
            else
                reject(new FfmpegError(`${bin} exited with ${signal ?? code}`, stderr.slice(-2000)));
        });
    });
}
/** Container duration in ms, or null if ffprobe can't tell (e.g. unfinalized WebM). */
export async function probeDurationMs(ffprobe, file) {
    const out = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}
/** Stream kinds present in a file, e.g. ["video", "audio"]. */
export async function probeStreams(ffprobe, file) {
    const out = await run(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
}
//# sourceMappingURL=ffmpeg.js.map