import { z } from "zod";

/** Largest single chunk the API will sign an upload for. 4 s of 4K at 50 Mbps is ~25 MB. */
export const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
export const MAX_SEQ = 10_000_000;

const serverTime = z.number().int().nonnegative();
/** A name people type: no control or formatting characters, which could forge lines in the consent record. */
const plainText = (max: number) =>
  z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]+$/u, "Letters, numbers and punctuation only");
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase hex SHA-256");
const mimeType = z.string().min(1).max(200);

// "mask" is a small black-and-white video of where the person is in their picture, recorded
// next to the camera when they blur their background. It only ever helps render their video:
// it is never an output, and a missing or unreadable one costs the blur, never the recording.
// "screen" is what a person shares from their display: picture only, recorded on their device
// while they share, like the camera. A person can have several in a recording (they shared,
// stopped, shared again); together they become one "<name> - screen.mp4".
export const trackKind = z.enum(["audio", "video", "mask", "screen"]);
export type TrackKind = z.infer<typeof trackKind>;
/** The kinds that are a person's recording (and become files). */
export type MediaKind = Exclude<TrackKind, "mask">;

// ── Accounts ──────────────────────────────────────────────────────────────────

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const signupBody = z.object({
  email,
  name: plainText(100),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  /** The install's SETUP_TOKEN: the first account needs it when the server has one. */
  setupToken: z.string().max(200).optional(),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
});

/** "I forgot my password": the address to send the link to. */
export const forgotPasswordBody = z.object({ email });
/** Share a recording on a public page (or stop): with or without its transcript; `newLink` replaces the link. */
export const shareBody = z.object({ enabled: z.boolean(), transcript: z.boolean(), newLink: z.boolean().optional() });
/** A new API key's name (what it is for), and a new webhook's address. */
export const apiKeyBody = z.object({ name: plainText(60) });
export const webhookBody = z.object({ url: z.string().url().max(500) });
/** A comment on a recording, optionally at a moment of it (ms from its start). */
export const commentBody = z.object({ body: z.string().trim().min(1).max(2000), atMs: z.number().min(0).optional() });
/** A share-safe copy of a transcript: neutral speaker names, contact details and listed words masked. */
export const safeTranscriptBody = z.object({
  format: z.enum(["txt", "docx", "srt", "vtt"]),
  pseudonyms: z.boolean(),
  contacts: z.boolean(),
  terms: z.array(z.string().max(80)).max(100),
  /** Only count what would be masked; no file. */
  preview: z.boolean().optional(),
});
/** Cut a clip out of a finished recording: from and to in ms from its start, and an optional title for the file's name. */
export const clipBody = z.object({ startMs: z.number().min(0), endMs: z.number().min(0), title: plainText(80).optional() });
/** A studio's solo link: on or off, and what the person is asked to talk about (one question per line). */
export const soloSettingsBody = z.object({ enabled: z.boolean(), prompt: z.string().max(4000) });
/** Someone opens a solo link to record alone. */
export const soloJoinBody = z.object({
  code: z.string().min(1).max(100),
  displayName: plainText(60),
  consent: z.literal(true, { error: "Consent to recording is required" }),
  consentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
/** The longest one solo recording runs, in minutes: it stops by itself there. */
export const SOLO_MAX_MINUTES = 30;
/** A studio's guide (run of show): the host's plan, one section or question per line. */
export const guideBody = z.object({ guide: z.string().max(8000) });
/** A marker on the running recording. No label: "Marker". */
export const markerBody = z.object({ label: plainText(200).optional() });
/** A host joins as a producer (in the call, never recorded) or as someone who is recorded. */
export const producerBody = z.object({ producer: z.boolean() });
/** The account's owner allows, or stops allowing, transcripts to be sent to an outside AI model for notes. */
export const aiNotesBody = z.object({ outside: z.boolean() });
/** How AI notes are written for this account, for its settings page. */
export interface AiNotesView {
  /** local: by a model on this server. outside: by an outside model the owner allowed. off: no notes. */
  mode: "local" | "outside" | "off";
  /** The models this server has set up, by name; null when it has none of that kind. */
  localModel: string | null;
  outsideModel: string | null;
  /** The owner has allowed the outside model. */
  outsideOn: boolean;
  /** The account's plan includes AI notes (always true on a self-hosted server). */
  planAllows: boolean;
  /** This person is the account's owner. */
  canChange: boolean;
}
/** The website's waitlist for Tapry Cloud's paid plans. */
export const waitlistBody = z.object({ email, plan: z.enum(["creator", "studio", "team", "own_storage"]).optional() });
export const removeWaitlistBody = z.object({ email });
/** The token from an emailed link (a new password, or confirming the address). */
const emailToken = z.string().min(20).max(200);
export const resetPasswordBody = z.object({
  token: emailToken,
  password: z.string().min(10, "Use at least 10 characters").max(200),
});
export const verifyEmailBody = z.object({ token: emailToken });

// ── Studios ───────────────────────────────────────────────────────────────────

/**
 * The sizes a camera is recorded and kept at: frame size and the recorder's bits per second
 * (the worker never spends more on the finished file). One table for the browser and the worker.
 */
export const VIDEO_TIERS = [
  { height: 720, width: 1280, bitrate: 4_000_000 },
  { height: 1080, width: 1920, bitrate: 8_000_000 },
  { height: 1440, width: 2560, bitrate: 14_000_000 },
  { height: 2160, width: 3840, bitrate: 24_000_000 },
] as const;
export type VideoHeight = (typeof VIDEO_TIERS)[number]["height"];
export type VideoTier = (typeof VIDEO_TIERS)[number];
export const VIDEO_QUALITIES = ["720p", "1080p", "2160p"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

/**
 * The tier a picture is kept at. 720p and 1080p studios: always the studio's own. A 4K studio
 * ("2160p") means "each camera's best, up to 4K": the smallest tier that holds what the camera
 * really delivers, never under 1080p, so a Full HD webcam in a 4K studio is a Full HD file at
 * Full HD's bitrate, not an upscaled one. `sourceHeight` unknown: the studio's own tier.
 */
export function videoTier(quality: VideoQuality, sourceHeight?: number | null): VideoTier {
  const top = VIDEO_TIERS.find((t) => `${t.height}p` === quality)!;
  if (top.height <= 1080 || !sourceHeight) return top;
  return VIDEO_TIERS.find((t) => t.height >= 1080 && t.height >= sourceHeight && t.height <= top.height) ?? top;
}

/**
 * Frames a second of the finished video files (cameras are asked for the nearest whole rate).
 * 30 suits the web; 25 and 24 match PAL and film timelines; 29.97 is broadcast NTSC.
 */
export const FRAME_RATES = ["24", "25", "29.97", "30"] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
/** The rate as ffmpeg takes it: 29.97 is exactly 30000/1001. */
export const ffmpegFrameRate = (rate: FrameRate) => (rate === "29.97" ? "30000/1001" : rate);

const settingsFields = {
  videoQuality: z.enum(VIDEO_QUALITIES),
  frameRate: z.enum(FRAME_RATES),
  /** Delete each recording this many days after its files are ready. Null: keep until someone deletes it. */
  deleteAfterDays: z.number().int().min(1).max(3650).nullable(),
  /** Guests besides the host. v1 targets 2–4 people in total. */
  maxGuests: z.number().int().min(1).max(7),
  /** Off gives better audio for guests on headphones. */
  echoCancellation: z.boolean(),
  /** Bring each person's audio, and the combined mix, to a common level for spoken audio (-16 LUFS) after recording. */
  levelLoudness: z.boolean(),
  /** Sound only: nobody's camera is asked for, the call is voice only, recordings have no video. */
  audioOnly: z.boolean(),
  /** Guests can download their own recording (their WAV, and MP4 with a camera) from the end screen. */
  guestDownloads: z.boolean(),
  /** Per-person audio (and the mix of an audio-only recording): WAV opens anywhere, FLAC is lossless at about half the size. */
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
  frameRate: settingsFields.frameRate.default("30"),
  deleteAfterDays: settingsFields.deleteAfterDays.default(null),
});

/** The consent text when a studio sets none. */
export function defaultConsentText(hostName: string, audioOnly: boolean) {
  return `I'm happy to be recorded. My ${audioOnly ? "microphone is" : "camera and microphone are"} recorded on this computer and sent to ${hostName}.`;
}

/** The exact text a guest of this studio agrees to (what's hashed and kept with their consent). */
export function consentTextFor(settings: StudioSettings, hostName: string) {
  return settings.consentText || defaultConsentText(hostName, settings.audioOnly);
}
export type StudioSettings = z.infer<typeof studioSettings>;

// No defaults here: in zod 4 `.partial()` still applies `.default()`, which would make
// every update silently reset the fields it didn't mention.
const settingsPatch = z.object(settingsFields).partial();

export const createStudioBody = z.object({
  name: plainText(100),
  settings: settingsPatch.optional(),
});

export const updateStudioBody = z.object({
  name: createStudioBody.shape.name.optional(),
  settings: settingsPatch.optional(),
});

export const joinBody = z.object({
  inviteCode: z.string().min(1).max(100),
  displayName: plainText(60),
  /** The guest ticked "I agree to be recorded". */
  consent: z.literal(true, { error: "Consent to recording is required" }),
  /**
   * SHA-256 (hex) of the consent text the guest was shown. When it isn't the studio's current
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
  name: plainText(60),
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
  /** `solo`: one person recording alone on a studio's solo link; they start and stop it themselves. */
  session: { id: string; studioId: string; status: "open" | "solo" | "ended" };
  /** The running recording, else the most recent one, else null. */
  recording: { id: string; status: "recording" | "stopped"; startedAt: number; stoppedAt: number | null } | null;
  /** `producer`: a host who is in the call and at the controls but is never recorded. */
  participants: Array<{ id: string; displayName: string; role: "host" | "guest"; producer: boolean }>;
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
  /** Each recording of this session they recorded in, oldest first. */
  recordings: Array<{
    number: number;
    processing: "pending" | "queued" | "processing" | "ready" | "failed";
    /** Signed, short-lived download links; empty until processing is ready. */
    files: Array<{ kind: "audio" | "video" | "screen"; fileName: string; bytes: number; url: string }>;
  }>;
  /** "Record your own" link (GUEST_PROMO_URL), or null when the server doesn't set one. */
  promoUrl: string | null;
}

/** The end screen's "email me my recording": state for this participant. */
export interface RecapStatus {
  /** The server sends email, the studio lets guests have their files, and they recorded something. */
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

// ── Filters ───────────────────────────────────────────────────────────────────
//
// What a person chooses for how they look and sound. The recorder never applies them: it keeps
// the untouched camera and microphone. They are shown live on the call's copies, and the worker
// applies them to that person's finished files (processing can also leave them out).
// "Mirror my view" isn't here: it only flips a person's own preview, on their device.

export const BRIGHTNESS_LEVELS = [0, 1, 2] as const; // 0: as it is, 1: brighter, 2: for a dark room
export const LOOKS = ["none", "warm", "cool", "mono"] as const;
export type Look = (typeof LOOKS)[number];
export const BACKGROUNDS = ["none", "blur"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const trackFilters = z.object({
  brightness: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  look: z.enum(LOOKS).default("none"),
  /** Softens skin a little. */
  touchUp: z.boolean().default(false),
  /** Blurs what's behind the person. Needs their device to record a mask track. */
  background: z.enum(BACKGROUNDS).default("none"),
  /** Takes steady background noise (fans, hiss) out of the microphone. */
  noiseRemoval: z.boolean().default(false),
});
export type TrackFilters = z.infer<typeof trackFilters>;

export const NO_FILTERS: TrackFilters = { brightness: 0, look: "none", touchUp: false, background: "none", noiseRemoval: false };

/** Does anything here change the picture / the sound? */
export const hasVideoFilters = (f: TrackFilters) => f.brightness !== 0 || f.look !== "none" || f.touchUp || f.background !== "none";
/** Does this need the device to work out where the person is (a mask)? */
export const needsMask = (f: TrackFilters) => f.background !== "none";
export const hasAudioFilters = (f: TrackFilters) => f.noiseRemoval;

/**
 * The numbers behind the picture filters, one table for the live preview (canvas) and the
 * worker (ffmpeg), so both look alike. brightness: added light (-1..1 scale of ffmpeg's eq);
 * gamma lifts shadows; saturation 0 is black and white; temperature in kelvin (6500 neutral).
 */
export const BRIGHTNESS_VALUES: Record<TrackFilters["brightness"], { brightness: number; contrast: number; gamma: number }> = {
  0: { brightness: 0, contrast: 1, gamma: 1 },
  1: { brightness: 0.04, contrast: 1.03, gamma: 1.15 },
  2: { brightness: 0.08, contrast: 1.06, gamma: 1.35 },
};
export const LOOK_VALUES: Record<Look, { saturation: number; temperature: number }> = {
  none: { saturation: 1, temperature: 6500 },
  warm: { saturation: 1.08, temperature: 5200 },
  cool: { saturation: 1.02, temperature: 8200 },
  mono: { saturation: 0, temperature: 6500 },
};

/** A person changes their filters during a session: applies to their tracks in recordings still open. */
export const setFiltersBody = z.object({ filters: trackFilters });

export const createTrackBody = z.object({
  trackId: z.string().regex(trackIdPattern).optional(),
  recordingId: z.string().min(1).max(100),
  kind: trackKind,
  mimeType,
  startedAt: serverTime,
  /** The person's filters when this track started (absent: none). */
  filters: trackFilters.optional(),
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
  /** Recording alone on a solo link: this person starts and stops their own recording, with no call. */
  solo?: { maxMinutes: number };
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

// ── Tapry Cloud plans ───────────────────────────────────────────────────────────
// Only a server run as Tapry Cloud (TAPRY_CLOUD=true) uses these. A self-hosted server has no
// plans and no limits. The figures are docs/plan/06-monetization.md (pricing v4).

export const PLAN_IDS = ["free", "own_storage", "creator", "studio", "team", "business"] as const;
export const planId = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof planId>;

export interface Plan {
  id: PlanId;
  name: string;
  /** Per month, in US dollars; a year costs ten months. Null: agreed per customer. */
  monthlyUsd: number | null;
  /** Recording hours in a billing month, counted per recording (not per person). Null: no limit. */
  hours: number | null;
  /** Days the finished files are kept after a recording is processed. Null: until deleted. */
  filesDays: number | null;
  /** Days the original uploads are kept after a recording is processed. Null: until deleted. */
  originalsDays: number | null;
  /** Guests see "Recorded with Tapry" at the end of a session. */
  badge: boolean;
  /**
   * Recording into the account's own bucket: not part of the plan, possible, or the only
   * storage the plan has (nothing is recorded until a bucket is connected).
   */
  ownStorage: "no" | "allowed" | "required";
  /** People in the account, its owner included. Null: no limit. */
  seats: number | null;
  /** Studios may record up to 4K. Otherwise Full HD is the most. */
  video4k: boolean;
  /** The owner may turn on AI notes written by an outside model. (Notes by a model on the server need no plan.) */
  aiNotes: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", monthlyUsd: 0, hours: 2, filesDays: 7, originalsDays: 7, badge: true, ownStorage: "no", seats: 1, video4k: false, aiNotes: false },
  // Everything is in the customer's bucket: nothing of ours to meter or to delete.
  own_storage: { id: "own_storage", name: "Own storage", monthlyUsd: 12, hours: null, filesDays: null, originalsDays: null, badge: false, ownStorage: "required", seats: 1, video4k: true, aiNotes: true },
  creator: { id: "creator", name: "Creator", monthlyUsd: 19, hours: 15, filesDays: 30, originalsDays: 7, badge: false, ownStorage: "no", seats: 1, video4k: false, aiNotes: true },
  studio: { id: "studio", name: "Studio", monthlyUsd: 39, hours: 40, filesDays: 60, originalsDays: 7, badge: false, ownStorage: "no", seats: 3, video4k: true, aiNotes: true },
  team: { id: "team", name: "Team", monthlyUsd: 149, hours: 80, filesDays: 90, originalsDays: 7, badge: false, ownStorage: "no", seats: 5, video4k: true, aiNotes: true },
  business: { id: "business", name: "Business", monthlyUsd: null, hours: null, filesDays: null, originalsDays: null, badge: false, ownStorage: "allowed", seats: null, video4k: true, aiNotes: true },
};

/** Whether moving from one plan to another is an upgrade (more hours or longer keeping). */
export const planRank = (id: PlanId) => PLAN_IDS.indexOf(id);

export type PlanStatus = "active" | "past_due" | "canceled";

/** `GET /api/billing`: a host's plan and what they have used of it. Tapry Cloud only. */
export interface BillingOverview {
  plan: Plan;
  /** canceled: paid until `endsAt`, then Free. past_due: the last payment failed. */
  status: PlanStatus;
  endsAt: string | null;
  /** The current billing month: recording hours start again at `periodEnd`. */
  periodStart: string;
  periodEnd: string;
  /** Recorded in this period, in milliseconds, deleted recordings included. */
  usedMs: number;
  /** Plans that can be bought from here, with the address of their checkout. */
  upgrades: Array<{ plan: Plan; url: string; /** The same plan paid by the year (ten months' price), where it is sold that way. */ yearlyUrl?: string }>;
  /**
   * Where to change the card, see invoices or cancel; null when there is nothing to manage.
   * "/api/billing/portal" is posted to (it mints a portal session); anything else is a link.
   */
  manageUrl: string | null;
}

export const setPlanBody = z.object({
  plan: planId,
  /** When the plan ends and the account goes back to Free (ISO date). Omit: no end. */
  endsAt: z.iso.datetime().nullish(),
});

// ── Own storage: an account's own S3-compatible bucket ──────────────────────────

export const ownStorageBody = z.object({
  /** The S3 endpoint (https). Empty for Amazon S3 itself, which is found by region. */
  endpoint: z.string().trim().max(300).optional(),
  region: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only"),
  bucket: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "A bucket name: lowercase letters, digits, dots and dashes"),
  accessKeyId: z.string().trim().min(1).max(200),
  secretAccessKey: z.string().min(1).max(500),
  /** Addresses like endpoint/bucket/key instead of bucket.endpoint/key (most non-Amazon stores). */
  forcePathStyle: z.boolean(),
});

export const confirmStorageCheckBody = z.object({ key: z.string().min(1).max(200) });

/** `GET /api/storage/own`. The secret key is never sent back. */
export interface OwnStorageView {
  /** The server offers own storage at all (it has a key to protect secrets with). */
  enabled: boolean;
  /** This account may use it (on Tapry Cloud, its plan says). */
  allowed: boolean;
  /** This account's plan has no other storage: recording waits for a connected bucket. */
  required: boolean;
  target: {
    endpoint: string | null;
    region: string;
    bucket: string;
    /** The last four characters of the access key id, to recognise it by. */
    accessKeyEnding: string;
    forcePathStyle: boolean;
    /** A test upload from a browser has arrived: new sessions record into this bucket. */
    verified: boolean;
    savedAt: string;
  } | null;
}

// ── Seats: several people in one account ────────────────────────────────────────

/** What a member may do: `member` everything but the owner's own things; `viewer` only look, listen, download and comment. */
export const MEMBER_ROLES = ["member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const inviteMemberBody = z.object({ email, role: z.enum(MEMBER_ROLES).default("member") });
export const memberRoleBody = z.object({ role: z.enum(MEMBER_ROLES) });
/** Accepting an invitation: someone new sends a name and a password; someone signed in sends nothing. */
export const acceptInviteBody = z.object({
  name: plainText(100).optional(),
  password: z.string().min(10, "Use at least 10 characters").max(200).optional(),
});

/** `GET /api/members`: the people in the signed-in person's account. */
export interface MembersView {
  /** How many people the account may hold, its owner included. Null: no limit. */
  seats: number | null;
  /** The signed-in person owns the account (and so may invite and remove). */
  owner: boolean;
  members: Array<{ id: string; name: string; email: string; role: "owner" | MemberRole; you: boolean }>;
  /** Invitations not yet accepted; only the owner sees them. */
  invites: Array<{ id: string; email: string; role: MemberRole; expiresAt: string }>;
}
