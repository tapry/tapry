export declare class FfmpegError extends Error {
    readonly stderrTail: string;
    constructor(message: string, stderrTail: string);
}
/**
 * Run a binary; resolves with stdout on exit 0 (or the end of stderr, with `stderr: true`:
 * ffmpeg's filters report measurements there), rejects with the end of stderr otherwise.
 */
export declare function run(bin: string, args: string[], opts?: {
    timeoutMs?: number;
    stderr?: boolean;
}): Promise<string>;
/** Container duration in ms, or null if ffprobe can't tell (e.g. unfinalized WebM). */
export declare function probeDurationMs(ffprobe: string, file: string): Promise<number | null>;
/** Stream kinds present in a file, e.g. ["video", "audio"]. */
export declare function probeStreams(ffprobe: string, file: string): Promise<string[]>;
