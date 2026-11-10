// Read-only views across all of a host's studios, for the dashboard's Studios, Guests,
// Transcripts, Storage and Settings pages. Nothing here changes a recording, an upload or a
// job. Transcript text is read from storage to show and search it, and never logged.
import { basename } from "node:path";
import type { StudioSettings, TechCheckResult } from "@tapry/shared";
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";
import type { HealthService } from "./health";
import { HEARTBEAT_MS } from "./jobs";
import type { OwnedRecording, ProcessingService } from "./processing";
import type { Storage } from "./storage";
import type { StudioService } from "./studios";
import { UPLOAD_GRACE_DAYS } from "./uploads";
import { APP_VERSION, type WorkerInfo } from "./worker-info";

/** What this install was configured with, for the admin's read-only Storage and Settings pages. Never the secrets. */
export interface ServerInfo {
  storage: { endpoint: string | null; region: string; bucket: string; accessKeyId: string };
  /** RAW_RETENTION_DAYS; null keeps the originals. */
  rawRetentionDays: number | null;
  /** WHISPER_MODEL on this web server (a separate worker reports its own). */
  whisperModel: string | null;
  emailOn: boolean;
  updateRepo: string | null;
  setupTokenSet: boolean;
  allowSignup: boolean;
  callOn: boolean;
}

const NO_SERVER_INFO: ServerInfo = {
  storage: { endpoint: null, region: "us-east-1", bucket: "", accessKeyId: "" },
  rawRetentionDays: null,
  whisperModel: null,
  emailOn: false,
  updateRepo: null,
  setupTokenSet: false,
  allowSignup: false,
  callOn: false,
};

export interface StudioCard {
  id: string;
  name: string;
  settings: StudioSettings;
  recordings: number;
  live: boolean;
  bytes: number;
  /** Length of every recording in it, a running one up to now. */
  recordedMs: number;
  lastRecordingAt: number | null;
  /** Who recorded in it most recently, newest first, at most three. */
  people: string[];
}

export interface GuestRow {
  name: string;
  studios: Array<{ id: string; name: string }>;
  /** Recordings they're in (with a track). */
  recordings: number;
  lastJoinedAt: number;
  /** The newest tech check sent under the same name in one of those studios (last 30 days), if any. */
  techCheck: { at: number; issues: Array<{ tone: "warn" | "danger"; label: string }> } | null;
}

export interface TranscriptTurn {
  speaker: string;
  startMs: number;
  text: string;
}

export interface TranscriptRow {
  recordingId: string;
  number: number;
  studioId: string;
  studioName: string;
  startedAt: number;
  state: OwnedRecording["transcript"];
  /** First thing said, or where the search matched (with … around it). Null until it's ready. */
  snippet: string | null;
  words: number | null;
  txt: string | null;
  srt: string | null;
}

export interface StorageOverview {
  bytes: number;
  studios: Array<{ id: string; name: string; bytes: number }>;
  recordings: number;
  originalsRemoved: number;
  /** Uploaded pieces the server confirmed, and pieces of finished tracks that never arrived. */
  pieces: { confirmed: number; missing: number };
  /** Admins only: whether storage answers, and how it's set up. */
  admin: {
    status: { ok: boolean; summary: string };
    endpointHost: string;
    bucket: string;
    accessKey: string;
    rawRetentionDays: number | null;
    uploadGraceDays: number;
  } | null;
}

export interface WorkspaceInfo {
  version: string;
  emailOn: boolean;
  transcriptsModel: { name: string; found: boolean | null } | null;
  updateRepo: string | null;
  rawRetentionDays: number | null;
  setupTokenSet: boolean;
  allowSignup: boolean;
  callOn: boolean;
}

/** Biggest transcript file read (an hour is ~100 KB); anything past this is left out. */
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
/** Transcripts kept parsed in memory, by output id (a new transcript gets new ids). */
const CACHE_ENTRIES = 300;
/** Newest transcripts looked at by the list and the search. */
const MAX_TRANSCRIPTS = 200;

interface Parsed {
  turns: TranscriptTurn[];
  words: number;
  /** Everything said, lowercased, for search. */
  lower: string;
}

export class LibraryService {
  private cache = new Map<string, Parsed>();

  constructor(
    private db: Db,
    private storage: Storage,
    private studios: StudioService,
    private processing: ProcessingService,
    private health: HealthService,
    private info: ServerInfo = NO_SERVER_INFO,
    private now: () => number = Date.now,
  ) {}

  /** The Studios page: each studio with its numbers and who recorded in it lately. */
  async studioCards(owner: User): Promise<StudioCard[]> {
    const studios = await this.studios.list(owner);
    if (studios.length === 0) return [];
    const totals = await this.db.query<{ studio_id: string; recorded_ms: number; last_at: number | null }>(
      `SELECT s.studio_id, coalesce(sum(coalesce(r.stopped_at, $2) - r.started_at), 0)::bigint AS recorded_ms, max(r.started_at) AS last_at
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL AND r.deleted_at IS NULL
       GROUP BY s.studio_id`,
      [owner.id, this.now()],
    );
    const people = await this.db.query<{ studio_id: string; display_name: string; at: number }>(
      `SELECT s.studio_id, p.display_name, max(r.started_at) AS at
       FROM tracks t JOIN participants p ON p.id = t.participant_id
       JOIN recordings r ON r.id = t.recording_id JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL AND r.deleted_at IS NULL
       GROUP BY s.studio_id, p.display_name
       ORDER BY at DESC, p.display_name`,
      [owner.id],
    );
    return studios.map((s) => {
      const t = totals.find((x) => x.studio_id === s.id);
      return {
        id: s.id,
        name: s.name,
        settings: s.settings,
        recordings: s.recordings,
        live: s.live,
        bytes: Number(s.bytes),
        recordedMs: Math.max(0, Number(t?.recorded_ms ?? 0)),
        lastRecordingAt: t?.last_at == null ? null : Number(t.last_at),
        people: people.filter((p) => p.studio_id === s.id).slice(0, 3).map((p) => p.display_name),
      };
    });
  }

  /**
   * Everyone who recorded as a guest in the host's studios, by name: in how many recordings,
   * when they last joined, and the newest tech check sent under the same name in those studios.
   */
  async guests(owner: User): Promise<GuestRow[]> {
    const rows = await this.db.query<{ name: string; studio_id: string; studio_name: string; recordings: number; last_joined: Date }>(
      `SELECT p.display_name AS name, st.id AS studio_id, st.name AS studio_name,
              count(DISTINCT t.recording_id)::int AS recordings, max(p.created_at) AS last_joined
       FROM participants p
       JOIN sessions s ON s.id = p.session_id JOIN studios st ON st.id = s.studio_id
       JOIN tracks t ON t.participant_id = p.id JOIN recordings r ON r.id = t.recording_id AND r.deleted_at IS NULL
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL AND p.role = 'guest'
       GROUP BY p.display_name, st.id, st.name`,
      [owner.id],
    );
    if (rows.length === 0) return [];
    const key = (name: string) => name.trim().toLocaleLowerCase();
    const checks = await this.db.query<{ studio_id: string; name: string; checks: TechCheckResult[]; created_at: Date }>(
      `SELECT studio_id, name, checks, created_at FROM tech_checks
       WHERE studio_id = ANY($1::text[]) AND created_at > now() - interval '30 days'
       ORDER BY created_at DESC`,
      [[...new Set(rows.map((r) => r.studio_id))]],
    );
    const byName = new Map<string, GuestRow & { studioIds: Set<string> }>();
    for (const r of rows) {
      const at = new Date(r.last_joined).getTime();
      const g = byName.get(key(r.name));
      if (!g) {
        byName.set(key(r.name), {
          name: r.name,
          studios: [{ id: r.studio_id, name: r.studio_name }],
          recordings: r.recordings,
          lastJoinedAt: at,
          techCheck: null,
          studioIds: new Set([r.studio_id]),
        });
        continue;
      }
      g.recordings += r.recordings;
      if (!g.studioIds.has(r.studio_id)) g.studios.push({ id: r.studio_id, name: r.studio_name });
      g.studioIds.add(r.studio_id);
      if (at > g.lastJoinedAt) {
        g.lastJoinedAt = at;
        g.name = r.name; // the spelling they used last
      }
    }
    return [...byName.entries()]
      .map(([k, { studioIds, ...g }]) => {
        const check = checks.find((c) => studioIds.has(c.studio_id) && key(c.name) === k);
        return {
          ...g,
          techCheck: check
            ? {
                at: new Date(check.created_at).getTime(),
                issues: check.checks.flatMap((c) => (c.tone === "ok" ? [] : [{ tone: c.tone, label: c.label }])),
              }
            : null,
        };
      })
      .sort((a, b) => b.lastJoinedAt - a.lastJoinedAt || a.name.localeCompare(b.name));
  }

  /**
   * The Transcripts page: every recording with a transcript (or one on its way), newest first.
   * With `query`, only finished transcripts that contain it, with the words around the match.
   */
  async transcripts(owner: User, query?: string): Promise<TranscriptRow[]> {
    const q = query?.trim().toLocaleLowerCase().slice(0, 100) ?? "";
    const recordings = (await this.processing.listForOwner(owner, { limit: 500 }))
      .filter((r) => r.transcript !== "off" || r.outputs.some((o) => o.kind === "transcript"))
      .slice(0, MAX_TRANSCRIPTS);
    const rows: TranscriptRow[] = [];
    for (const r of recordings) {
      const file = (ext: string) => r.outputs.find((o) => o.kind === "transcript" && o.fileName.toLowerCase().endsWith(ext))?.id ?? null;
      const parsed = await this.read(r);
      if (q && !parsed?.lower.includes(q)) continue;
      rows.push({
        recordingId: r.id,
        number: r.number,
        studioId: r.studioId,
        studioName: r.studioName,
        startedAt: r.startedAt,
        state: r.transcript,
        snippet: parsed ? (q ? around(parsed, q) : (parsed.turns[0]?.text.slice(0, 160) ?? null)) : null,
        words: parsed?.words ?? null,
        txt: file(".txt"),
        srt: file(".srt"),
      });
    }
    return rows;
  }

  /** What was said in one recording, turn by turn (speaker = track), or null before it's ready. */
  async transcriptTurns(owner: User, recordingId: string): Promise<{ state: OwnedRecording["transcript"]; turns: TranscriptTurn[] | null }> {
    const r = await this.processing.getForOwner(owner, recordingId);
    const parsed = await this.read(r);
    return { state: r.transcript, turns: parsed?.turns ?? null };
  }

  /** The Storage page. Configuration and the live storage check for admins only. */
  async storageOverview(user: User): Promise<StorageOverview> {
    const studios = await this.studios.list(user);
    const [counts] = await this.db.query<{ recordings: number; raw_removed: number }>(
      `SELECT count(*)::int AS recordings, count(*) FILTER (WHERE r.raw_deleted_at IS NOT NULL)::int AS raw_removed
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [user.id],
    );
    const owned = `JOIN recordings r ON r.id = t.recording_id JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL AND r.deleted_at IS NULL AND r.raw_deleted_at IS NULL`;
    const [pieces] = await this.db.query<{ confirmed: number; missing: number }>(
      `SELECT (SELECT count(*) FROM chunks c JOIN tracks t ON t.id = c.track_id ${owned})::int AS confirmed,
              (SELECT coalesce(sum(coalesce(cardinality(t.missing_seqs), 0)), 0) FROM tracks t ${owned})::int AS missing`,
      [user.id],
    );
    let admin: StorageOverview["admin"] = null;
    if (user.isAdmin) {
      const check = await this.health.storageCheck();
      const s = this.info.storage;
      admin = {
        status: { ok: check.tone === "ok", summary: check.summary },
        endpointHost: endpointHost(s.endpoint, s.region),
        bucket: s.bucket,
        accessKey: maskKey(s.accessKeyId),
        rawRetentionDays: this.info.rawRetentionDays,
        uploadGraceDays: UPLOAD_GRACE_DAYS,
      };
    }
    return {
      bytes: studios.reduce((n, s) => n + Number(s.bytes), 0),
      studios: studios.map((s) => ({ id: s.id, name: s.name, bytes: Number(s.bytes) })),
      recordings: counts?.recordings ?? 0,
      originalsRemoved: counts?.raw_removed ?? 0,
      pieces: { confirmed: pieces?.confirmed ?? 0, missing: pieces?.missing ?? 0 },
      admin,
    };
  }

  /** The bucket every studio's files are in, for admins (hosts don't see how the server is set up). */
  bucketFor(user: User): string | null {
    return user.isAdmin && this.info.storage.bucket ? this.info.storage.bucket : null;
  }

  /**
   * The transcript model the running workers use (its file name), or null when transcripts are off.
   * `found` is false when a running worker reports the file missing (transcripts then fail), and
   * null when no worker is running to say.
   */
  async transcriptsModel(): Promise<{ name: string; found: boolean | null } | null> {
    const rows = await this.db.query<{ info: WorkerInfo }>(
      "SELECT info FROM workers WHERE seen_at > now() - ($1::int * interval '1 millisecond') ORDER BY seen_at DESC",
      [3 * HEARTBEAT_MS],
    );
    const whisper = rows.find((r) => r.info?.whisper)?.info.whisper;
    const model = whisper?.model ?? this.info.whisperModel;
    return model ? { name: basename(model), found: whisper ? whisper.modelFound : null } : null;
  }

  /** The admin's Workspace settings: how this server is set up, read-only. */
  async workspace(user: User): Promise<WorkspaceInfo> {
    if (!user.isAdmin) throw new ApiError(404, "not_found", "Not found");
    return {
      version: APP_VERSION,
      emailOn: this.info.emailOn,
      transcriptsModel: await this.transcriptsModel(),
      updateRepo: this.info.updateRepo,
      rawRetentionDays: this.info.rawRetentionDays,
      setupTokenSet: this.info.setupTokenSet,
      allowSignup: this.info.allowSignup,
      callOn: this.info.callOn,
    };
  }

  /** A recording's transcript, parsed (cached by the file's id), or null when there's none to read. */
  private async read(r: OwnedRecording): Promise<Parsed | null> {
    if (r.transcript !== "ready") return null;
    const vtt = r.outputs.find((o) => o.kind === "transcript" && o.fileName.toLowerCase().endsWith(".vtt"));
    const txt = r.outputs.find((o) => o.kind === "transcript" && o.fileName.toLowerCase().endsWith(".txt"));
    const file = vtt ?? txt;
    if (!file) return null;
    const hit = this.cache.get(file.id);
    if (hit) {
      // Most recently used goes last, so the oldest is dropped first.
      this.cache.delete(file.id);
      this.cache.set(file.id, hit);
      return hit;
    }
    const [row] = await this.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE id = $1 AND recording_id = $2", [file.id, r.id]);
    if (!row) return null;
    let text: string;
    try {
      text = await readText(this.storage, row.storage_key, MAX_TRANSCRIPT_BYTES);
    } catch {
      return null; // Not readable right now: the page shows it without text. Nothing logged (it's someone's words).
    }
    const turns = toTurns(file === vtt ? parseVtt(text) : parseTxt(text));
    const all = turns.map((t) => t.text).join(" ");
    const parsed: Parsed = { turns, words: all.split(/\s+/).filter(Boolean).length, lower: all.toLocaleLowerCase() };
    this.cache.set(file.id, parsed);
    if (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    return parsed;
  }
}

/** The text of a stored object, up to `max` bytes. */
async function readText(storage: Storage, key: string, max: number) {
  const reader = (await storage.openRead(key)).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const p of parts) {
    const take = p.subarray(0, all.length - at);
    all.set(take, at);
    at += take.length;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

interface Cue {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

const stampMs = (s: string) => {
  const m = /^(\d+):(\d\d):(\d\d)(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number((m[4] ?? "0").padEnd(3, "0"));
};
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The worker's WebVTT (apps/worker transcribe.ts toVtt): one cue per segment, `<v Speaker>` in front. */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of vtt.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [from, to] = lines[at]!.split("-->");
    const startMs = stampMs(from ?? "");
    if (startMs === null) continue;
    const endMs = stampMs((to ?? "").trim().split(/\s+/)[0] ?? "") ?? startMs;
    const body = lines.slice(at + 1).join(" ").trim();
    const voice = /^<v(?:\.[^ >]*)? ([^>]*)>([\s\S]*)$/.exec(body);
    const text = unescape((voice ? voice[2]! : body).replace(/<\/v>/g, "")).trim();
    if (text) cues.push({ speaker: voice ? unescape(voice[1]!.trim()) : "", startMs, endMs, text });
  }
  return cues;
}

/** The worker's readable transcript (toTxt): `[00:01:02] Speaker: text`, a blank line between turns. */
export function parseTxt(txt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of txt.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const m = /^\[(\d+:\d\d:\d\d)\] ([^:]*): ([\s\S]*)$/.exec(block.trim());
    if (!m) continue;
    const startMs = stampMs(m[1]!)!;
    cues.push({ speaker: m[2]!, startMs, endMs: startMs, text: m[3]!.trim() });
  }
  return cues;
}

/** Consecutive cues of one speaker less than 3 s apart become one turn, as in the TXT and DOCX files. */
export function toTurns(cues: Cue[]): TranscriptTurn[] {
  const turns: Array<TranscriptTurn & { endMs: number }> = [];
  for (const c of cues) {
    const last = turns.at(-1);
    if (last && last.speaker === c.speaker && c.startMs - last.endMs < 3000) {
      last.text += ` ${c.text}`;
      last.endMs = c.endMs;
    } else {
      turns.push({ ...c });
    }
  }
  return turns.map(({ speaker, startMs, text }) => ({ speaker, startMs, text }));
}

/** "…the words around the match…", from the turn where it is. */
function around(p: Parsed, q: string) {
  const turn = p.turns.find((t) => t.text.toLocaleLowerCase().includes(q));
  if (!turn) return null;
  const at = turn.text.toLocaleLowerCase().indexOf(q);
  const from = Math.max(0, at - 60);
  const to = Math.min(turn.text.length, at + q.length + 80);
  return `${from > 0 ? "…" : ""}${turn.text.slice(from, to).trim()}${to < turn.text.length ? "…" : ""}`;
}

/** "s3.eu-west-1.amazonaws.com", or the host of S3_ENDPOINT. */
export function endpointHost(endpoint: string | null, region: string) {
  if (!endpoint) return `s3.${region}.amazonaws.com`;
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** An access key id with only its ends showing: "AKIA…9F3E". */
export function maskKey(key: string) {
  if (!key) return "";
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
