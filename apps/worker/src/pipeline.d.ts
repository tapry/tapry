export interface TrackInput {
    trackId: string;
    participantId: string;
    participantName: string;
    kind: "audio" | "video";
    /** The track's chunks concatenated in seq order (WebM or MP4 as MediaRecorder wrote it). */
    rawPath: string;
    /** Track start minus recording start, server clock. Positive: the track started late. */
    offsetMs: number;
}
export interface PipelineOptions {
    ffmpeg: string;
    ffprobe: string;
    /** Scratch folder for outputs; the caller uploads and deletes it. */
    workDir: string;
    /** Recording length (Record → Stop). Every output is exactly this long. */
    durationMs: number;
    videoHeight: 720 | 1080;
    /** Per ffmpeg invocation. Default: 10× real time, at least 2 minutes. */
    timeoutMs?: number;
    /** Font for names on the combined video's tiles. Unset: found automatically; null: no names. */
    font?: string | null;
    /** Level every person's audio, and the combined mix, to this target. Unset or null: left as recorded. */
    loudness?: LoudnessTarget | null;
    /** Told before each file is rendered: how many are done, of how many, and which one is next. */
    onProgress?: (p: {
        done: number;
        total: number;
        current: string;
    }) => void;
}
export interface LoudnessTarget {
    /** Integrated loudness to aim for (EBU R128, LUFS). */
    lufs: number;
    /** Never let the true peak go above this (dBTP): the gain is lowered instead. */
    truePeakDb: number;
    /** Most a quiet track is raised, so a near-silent mic doesn't become loud hiss. */
    maxBoostDb: number;
}
/** What podcast platforms ask for (Apple: -16 LUFS, peaks under -1 dBTP). */
export declare const PODCAST_LOUDNESS: LoudnessTarget;
export interface LoudnessMeasurement {
    /** Integrated loudness in LUFS; null for silence (nothing above the -70 LUFS gate). */
    integrated: number | null;
    /** True peak in dBTP; null for digital silence. */
    truePeak: number | null;
}
export interface OutputFile {
    kind: "audio" | "video" | "combined";
    trackId?: string;
    participantId?: string;
    path: string;
    fileName: string;
    contentType: string;
    durationMs: number | null;
    /** Gain applied to level the audio (dB), when loudness levelling is on and the file has sound. */
    gainDb?: number;
}
/**
 * Most bits per second a person's processed video may use: what the browser recorded at
 * (apps/web recording.ts). x264 aims for quality (CRF 20) but never spends more than the original
 * had, so noisy or busy footage can't come out bigger than the upload without being better.
 */
export declare const VIDEO_MAX_BITRATE: {
    readonly 1080: 8000000;
    readonly 720: 4000000;
};
/** Join chunk files into one, in the order given. MediaRecorder chunks are byte-continuous. */
export declare function concatChunks(chunkPaths: string[], outPath: string): Promise<void>;
/**
 * Filters that put a track on the recording's timeline: a late start is padded with
 * silence / black, an early start (clock error) is trimmed, the end is padded so -t can
 * cut every output to the same length.
 */
export declare function alignmentFilters(kind: "audio" | "video", offsetMs: number, 
/** How video ends: freeze the last frame (a whole track), or black (one piece of several). */
videoEnd?: "clone" | "black"): string;
/**
 * Loudness of a file's audio, measured the EBU R128 way by ffmpeg's loudnorm filter
 * (measurement only: its output is discarded).
 */
export declare function measureLoudness(ffmpeg: string, path: string, timeoutMs?: number): Promise<LoudnessMeasurement>;
/**
 * The one fixed gain (dB) that brings audio to the target: plain volume, no compression or
 * limiting, so it sounds exactly as recorded, only louder or quieter. Lower than the target
 * asks when the peaks would otherwise pass the ceiling; 0 for silence.
 */
export declare function loudnessGain(m: LoudnessMeasurement, target: LoudnessTarget): number;
/** Grid for n tiles in a 16:9 frame: 1 → 1×1, 2 → 2×1, 3–4 → 2×2, 5–9 → 3×3. */
export declare function gridLayout(n: number, width?: number, height?: number): {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
/**
 * Render every downloadable file for one recording:
 * per participant a WAV of their audio track and an MP4 of their camera track, plus one
 * combined grid video with everyone's audio mixed (a mixed WAV when nobody had a camera on).
 * All aligned to the moment Record was pressed.
 */
export declare function renderRecording(tracks: TrackInput[], opts: PipelineOptions): Promise<OutputFile[]>;
/** Fonts tried for tile names when none is configured: Debian's DejaVu (Docker), then macOS. */
export declare const FONT_CANDIDATES: string[];
export declare function findFont(candidates?: string[]): Promise<string | null>;
