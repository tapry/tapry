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
  /** Sound only: nobody's camera is asked for, the call is voice only, episodes have no video. */
  audioOnly: z.boolean(),
  /** Guests can download their own recording (their WAV, and MP4 with a camera) from the end screen. */
  guestDownloads: z.boolean(),
  /** Per-person audio (and the mix of an audio-only episode): WAV opens anywhere, FLAC is lossless at about half the size. */
  audioFormat: z.enum(["wav", "flac"]),
  /** What guests agree to before joining. Empty: the default text (defaultConsentText). */
  consentText: z.string().trim().max(4000),
};

/** Full settings, with defaults filled in. */
export const studioSettings = z.object({
  videoQuality: settingsFields.videoQuality.default("1080p"),
  maxGuests: settingsFields.maxGuests.default(3),
  echoCancellation: settingsFields.echoCancellation.default(true),
  levelLoudness: settingsFields.levelLoudness.default(true),
  audioOnly: settingsFields.audioOnly.default(false),
  guestDownloads: settingsFields.guestDownloads.default(true),
  consentText: settingsFields.consentText.default(""),
  audioFormat: settingsFields.audioFormat.default("wav"),
});

/** The consent text when a show sets none. */
export function defaultConsentText(hostName: string, audioOnly: boolean) {
  return `I'm happy to be recorded. My ${audioOnly ? "microphone is" : "camera and microphone are"} recorded on this computer and sent to ${hostName}.`;
}

/** The exact text a guest of this show agrees to (what's hashed and kept with their consent). */
export function consentTextFor(settings: StudioSettings, hostName: string) {
  return settings.consentText || defaultConsentText(hostName, settings.audioOnly);
}
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
  /**
   * SHA-256 (hex) of the consent text the guest was shown. When it isn't the show's current
   * text (the host changed it meanwhile), joining is refused so they read the new one.
   * Optional for pages loaded before this existed.
   */
  consentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

// ── Guest tech check (before the session; results go to the host only if the guest sends them) ──

export const techCheckResult = z.object({
  id: z.string().min(1).max(30),
  tone: z.enum(["ok", "warn", "danger"]),
  label: z.string().min(1).max(200),
});
export type TechCheckResult = z.infer<typeof techCheckResult>;

export const techCheckReport = z.object({
  /** Chosen by the page, so sending again (after another try) updates the same report. */
  reportId: z.string().regex(/^chk_[A-Za-z0-9_-]{8,40}$/),
  name: z.string().trim().min(1).max(60),
  /** "Chrome on macOS": worked out by the page from its user agent. */
  browser: z.string().max(60),
  checks: z.array(techCheckResult).min(1).max(12),
});

/** Most test data one upload-speed request may carry. */
export const SPEED_TEST_MAX_BYTES = 8 * 1024 * 1024;

// ── Quality alerts (each device reports metadata about itself; never media) ──

export const qualityAlert = z.enum([
  /** The mic's level hits the top repeatedly: the recording is distorting. */
  "clipping",
  /** Unmuted, yet the mic has picked up nothing for a while. */
  "mic_silent",
  /** The person is talking, but their level stays low: hard to hear once mixed. */
  "too_quiet",
  /** The mic picks up the call from the speakers: the others are in this person's recording. */
  "echo",
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

/** How long one person has talked during one recording (voice activity on their own device). */
export const talkTime = z.object({
  recordingId: z.string().min(1).max(64),
  ms: z.number().int().min(0).max(7 * 86_400_000),
});
export type TalkTime = z.infer<typeof talkTime>;

export const telemetryBody = z.object({
  alerts: z.array(qualityAlert).max(10),
  /** How far the upload is behind, in seconds; null when caught up. */
  uploadBehindS: z.number().int().min(0).max(7 * 86_400).nullable(),
  /** Talk time in the current recording; null when not recording. Optional for older clients. */
  talk: talkTime.nullable().optional(),
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
    /** Talk time in the recording the device last reported for (talk balance). */
    talk: TalkTime | null;
    /** Server time of the report. A device that stops reporting (offline, asleep) goes stale. */
    reportedAt: number;
  }>;
  /** Server clock when this snapshot was made. */
  serverTime: number;
}

/** What a participant's end screen shows: their own files from this session, and the promo link. */
export interface OwnRecordings {
  /** False when the host doesn't let guests download their own recording. */
  downloads: boolean;
  /** Each episode of this session they recorded in, oldest first. */
  recordings: Array<{
    number: number;
    processing: "pending" | "queued" | "processing" | "ready" | "failed";
    /** Signed, short-lived download links; empty until processing is ready. */
    files: Array<{ kind: "audio" | "video"; fileName: string; bytes: number; url: string }>;
  }>;
  /** "Record your own" link (GUEST_PROMO_URL), or null when the server doesn't set one. */
  promoUrl: string | null;
}

/** The end screen's "email me my recording": state for this participant. */
export interface RecapStatus {
  /** The server sends email, the show lets guests have their files, and they recorded something. */
  enabled: boolean;
  status: "none" | "pending" | "sent" | "failed";
  /** Only until it's sent: the address isn't kept after that. */
  email: string | null;
  /** False once this recording has been emailed the maximum number of times. */
  canSend: boolean;
}

export const recapBody = z.object({ email });

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
