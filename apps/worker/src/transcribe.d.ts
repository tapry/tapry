export interface WhisperOptions {
    /** whisper.cpp's `whisper-cli`. */
    whisper: string;
    /** ggml model file, e.g. ggml-base.bin (multilingual). */
    model: string;
    /** Silero VAD model for whisper.cpp. Strongly recommended: stops Whisper inventing text in silence. */
    vadModel?: string;
    ffmpeg: string;
    /** "auto" (default) detects per speaker. */
    language?: string;
    threads?: number;
    timeoutMs?: number;
}
export interface Segment {
    startMs: number;
    endMs: number;
    text: string;
}
export interface SpeakerTranscript {
    speaker: string;
    language: string | null;
    segments: Segment[];
}
/** Transcribe one person's audio (any format ffmpeg reads). */
export declare function transcribeAudio(audioPath: string, opts: WhisperOptions): Promise<{
    language: string | null;
    segments: Segment[];
}>;
export interface Line {
    speaker: string;
    startMs: number;
    endMs: number;
    text: string;
}
/** Everyone's segments on one timeline, by start time. */
export declare function mergeSpeakers(speakers: SpeakerTranscript[]): Line[];
/** SubRip: numbered cues, speaker name in front of each line. */
export declare function toSrt(lines: Line[]): string;
/** WebVTT with voice tags, so players and editors can tell speakers apart. */
export declare function toVtt(lines: Line[]): string;
/** Readable transcript: one paragraph per turn, consecutive lines of the same speaker joined. */
export declare function toTxt(lines: Line[]): string;
