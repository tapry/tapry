import { z } from "zod";

/** Largest single chunk the API will sign an upload for. 4 s of 4K at 50 Mbps is ~25 MB. */
export const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
export const MAX_SEQ = 10_000_000;

const serverTime = z.number().int().nonnegative();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase hex SHA-256");
const mimeType = z.string().min(1).max(200);

export const trackKind = z.enum(["audio", "video"]);
export type TrackKind = z.infer<typeof trackKind>;

// ── Accounts ──────────────────────────────────────────────────────────────────

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const signupBody = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
});

// ── Studios ───────────────────────────────────────────────────────────────────

const settingsFields = {
  videoQuality: z.enum(["720p", "1080p"]),
  /** Guests besides the host. v1 targets 2–4 people in total. */
  maxGuests: z.number().int().min(1).max(7),
  /** Off gives better audio for guests on headphones. */
  echoCancellation: z.boolean(),
  /** Bring each person's audio, and the combined mix, to podcast loudness (-16 LUFS) after recording. */
  levelLoudness: z.boolean(),
};

/** Full settings, with defaults filled in. */
export const studioSettings = z.object({
  videoQuality: settingsFields.videoQuality.default("1080p"),
  maxGuests: settingsFields.maxGuests.default(3),
  echoCancellation: settingsFields.echoCancellation.default(true),
  levelLoudness: settingsFields.levelLoudness.default(true),
});
export type StudioSettings = z.infer<typeof studioSettings>;

// No defaults here: in zod 4 `.partial()` still applies `.default()`, which would make
// every update silently reset the fields it didn't mention.
const settingsPatch = z.object(settingsFields).partial();

export const createStudioBody = z.object({
  name: z.string().trim().min(1).max(100),
  settings: settingsPatch.optional(),
});

export const updateStudioBody = z.object({
  name: createStudioBody.shape.name.optional(),
  settings: settingsPatch.optional(),
});

export const joinBody = z.object({
  inviteCode: z.string().min(1).max(100),
  displayName: z.string().trim().min(1).max(60),
  /** The guest ticked "I agree to be recorded". */
  consent: z.literal(true, { error: "Consent to recording is required" }),
});

// ── Quality alerts (each device reports metadata about itself; never media) ──

export const qualityAlert = z.enum([
  /** The mic's level hits the top repeatedly: the recording is distorting. */
  "clipping",
  /** Unmuted, yet the mic has picked up nothing for a while. */
  "mic_silent",
  /** The oldest chunk not yet uploaded is more than a minute old. */
  "upload_behind",
  /** Too little browser storage left to keep buffering the recording. */
  "low_disk",
  /** The tab is in the background; some browsers (phones especially) stop recording then. */
  "tab_hidden",
  /** A recorder failed on this device. */
  "recorder_error",
  /** Not on headphones: the main cause of echo. Information, not a fault. */
  "no_headphones",
]);
export type QualityAlert = z.infer<typeof qualityAlert>;

/** A device that hasn't reported for this long shows as "not reporting" to the host. */
export const STALE_REPORT_MS = 15_000;

export const telemetryBody = z.object({
  alerts: z.array(qualityAlert).max(10),
  /** How far the upload is behind, in seconds; null when caught up. */
  uploadBehindS: z.number().int().min(0).max(7 * 86_400).nullable(),
});

// ── Live session state (pushed over SSE, also returned by GET .../state) ─────

export interface SessionState {
  session: { id: string; studioId: string; status: "open" | "ended" };
  /** The running recording, else the most recent one, else null. */
  recording: { id: string; status: "recording" | "stopped"; startedAt: number; stoppedAt: number | null } | null;
  participants: Array<{ id: string; displayName: string; role: "host" | "guest" }>;
  /** Upload progress per participant for `recording`, so the host can see who is still uploading. */
  uploads: Array<{
    participantId: string;
    tracks: number;
    /** Tracks whose client has confirmed every chunk is uploaded. */
    completeTracks: number;
    bytes: number;
  }>;
  /** Each participant's latest quality report (alerts), for the host's view. */
  health: Array<{
    participantId: string;
    alerts: QualityAlert[];
    uploadBehindS: number | null;
    /** Server time of the report. A device that stops reporting (offline, asleep) goes stale. */
    reportedAt: number;
  }>;
  /** Server clock when this snapshot was made. */
  serverTime: number;
}

// ── Uploads ───────────────────────────────────────────────────────────────────

/** Track ids are chosen by the client so recording can start before the server is reachable. */
export const trackIdPattern = /^trk_[A-Za-z0-9_-]{16,40}$/;

export const createTrackBody = z.object({
  trackId: z.string().regex(trackIdPattern).optional(),
  recordingId: z.string().min(1).max(100),
  kind: trackKind,
  mimeType,
  startedAt: serverTime,
});

export const uploadUrlBody = z.object({
  bytes: z.number().int().positive().max(MAX_CHUNK_BYTES),
  mimeType,
  sha256: sha256Hex,
});

export const commitChunkBody = z
  .object({
    bytes: z.number().int().positive().max(MAX_CHUNK_BYTES),
    startTs: serverTime,
    endTs: serverTime,
    sha256: sha256Hex,
  })
  .refine((b) => b.endTs >= b.startTs, { message: "endTs must not be before startTs" });

export const completeTrackBody = z.object({
  stoppedAt: serverTime,
  /** null: the client lost count after a crash; the server uses the highest committed seq. */
  lastSeq: z.number().int().min(-1).max(MAX_SEQ).nullable(),
  interrupted: z.boolean().optional(),
});

export const seqParam = z.coerce.number().int().min(0).max(MAX_SEQ);

/** Responses from POST .../chunks/:seq/upload-url */
export type UploadUrlResponse =
  | { url: string; headers: Record<string, string> }
  /** Already stored with the same checksum (a retry after a lost response). Skip the PUT and commit. */
  | { committed: true };

/** Object key for one chunk. See docs/decisions/0001-one-object-per-chunk.md */
export function chunkStorageKey(sessionId: string, trackId: string, seq: number) {
  return `recordings/${sessionId}/${trackId}/${String(seq).padStart(8, "0")}.chunk`;
}

/** What a client needs to enter a session (POST /api/studios/:id/open, POST /api/join). */
export interface SessionTicket {
  sessionId: string;
  participantId: string;
  /** Participant bearer token for every /api/sessions/:id/* call. */
  token: string;
  role: "host" | "guest";
  studio: { name: string; settings: StudioSettings };
}

/** POST /api/sessions/:id/call-token. `enabled: false` when the server has no LiveKit configured. */
export type CallToken =
  | { enabled: false }
  | {
      enabled: true;
      /** LiveKit WebSocket URL the browser connects to. */
      url: string;
      token: string;
      room: string;
    };
