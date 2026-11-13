// Timeline exports: project files that place a recording's finished files on a timeline, so an
// editor opens the session ready instead of importing and lining files up by hand.
//
// Every finished file starts at the recording's start and has its exact length, so the timeline
// is simple: one track per file, all at 0. Markers set during the recording come along.
// The files are referred to by name, relative to the project file: unzip the recording into one
// folder and open the project from there.
//   Timeline.otio    OpenTimelineIO (DaVinci Resolve, and anything with an OTIO adapter)
//   Timeline.fcpxml  Final Cut Pro XML 1.9 (Final Cut Pro, DaVinci Resolve)
//   Timeline.rpp     REAPER project (sound only: each person's audio on its own track)
import { ffmpegFrameRate, studioSettings, type FrameRate } from "@tapry/shared";
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";

export interface TimelineFile {
  fileName: string;
  kind: "audio" | "video" | "screen";
  /** Whose it is, for the track's name. */
  person: string;
}

export interface TimelineInput {
  title: string;
  durationMs: number;
  frameRate: FrameRate;
  files: TimelineFile[];
  markers: Array<{ atMs: number; label: string }>;
  /**
   * The parts of the recording to keep, in order (ms from its start), when long pauses are left
   * out. Every track is cut at the same places, so everyone stays in sync. Left out: all of it.
   */
  keep?: Array<[number, number]>;
}

/** A pause this long with nobody speaking is left out. */
export const PAUSE_MIN_MS = 2000;
/** What stays of a pause on each side of the cut, so speech isn't clipped and breaths sound natural. */
export const PAUSE_PAD_MS = 400;

/**
 * The parts to keep when long pauses go: everything from shortly before someone speaks to
 * shortly after, with gaps under PAUSE_MIN_MS left alone. `speech` is when anyone is speaking.
 * Nothing said (or nothing known): the whole recording.
 */
export function keepRanges(speech: Array<[number, number]>, durationMs: number): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const [from, to] of [...speech].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(0, from - PAUSE_PAD_MS);
    const end = Math.min(durationMs, to + PAUSE_PAD_MS);
    if (end <= start) continue;
    const last = merged.at(-1);
    // Close enough to the last stretch of speech: the pause between them stays.
    if (last && start - last[1] < PAUSE_MIN_MS - 2 * PAUSE_PAD_MS) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.length > 0 ? merged : [[0, durationMs]];
}

/** The kept parts as whole frames: where each starts in the source, where it lands on the timeline, how long. */
function segments(t: TimelineInput): Array<{ src: number; at: number; length: number }> {
  const total = frames(t.durationMs, t.frameRate);
  const out: Array<{ src: number; at: number; length: number }> = [];
  let at = 0;
  for (const [from, to] of t.keep ?? [[0, t.durationMs]]) {
    const src = Math.min(total, Math.max(out.length ? out.at(-1)!.src + out.at(-1)!.length : 0, frames(from, t.frameRate)));
    const length = Math.min(total, frames(to, t.frameRate)) - src;
    if (length <= 0) continue;
    out.push({ src, at, length });
    at += length;
  }
  return out.length > 0 ? out : [{ src: 0, at: 0, length: total }];
}

/** Where a moment of the recording lands once pauses are out (frames); a moment inside a removed pause moves to the cut. */
function placed(frame: number, segs: Array<{ src: number; at: number; length: number }>): number {
  for (const s of segs) {
    if (frame < s.src) return s.at;
    if (frame < s.src + s.length) return s.at + (frame - s.src);
  }
  const last = segs.at(-1)!;
  return last.at + last.length - 1;
}

export const TIMELINE_FORMATS = ["otio", "fcpxml", "rpp"] as const;
export type TimelineFormat = (typeof TIMELINE_FORMATS)[number];

const CONTENT_TYPE: Record<TimelineFormat, string> = {
  otio: "application/json; charset=utf-8",
  fcpxml: "application/xml; charset=utf-8",
  rpp: "text/plain; charset=utf-8",
};

/** A frame rate as a fraction: frames per `den` seconds. */
function fraction(rate: FrameRate): { num: number; den: number; fps: number } {
  const [num, den] = ffmpegFrameRate(rate).split("/").map(Number) as [number, number | undefined];
  return { num, den: den ?? 1, fps: num / (den ?? 1) };
}
const frames = (ms: number, rate: FrameRate) => Math.round((ms / 1000) * fraction(rate).fps);
const url = (fileName: string) => encodeURIComponent(fileName).replace(/%2F/g, "/");
const trackName = (f: TimelineFile) => (f.kind === "screen" ? `${f.person} (screen)` : f.person);

export function toOtio(t: TimelineInput): string {
  const rate = fraction(t.frameRate).fps;
  const time = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
  const range = (start: number, duration: number) => ({ OTIO_SCHEMA: "TimeRange.1", duration: time(duration), start_time: time(start) });
  const total = frames(t.durationMs, t.frameRate);
  const segs = segments(t);
  const track = (f: TimelineFile) => ({
    OTIO_SCHEMA: "Track.1",
    name: trackName(f),
    kind: f.kind === "audio" ? "Audio" : "Video",
    metadata: {},
    effects: [],
    markers: [],
    source_range: null,
    children: segs.map((seg) => ({
      OTIO_SCHEMA: "Clip.1",
      name: f.fileName,
      metadata: {},
      effects: [],
      markers: [],
      source_range: range(seg.src, seg.length),
      media_reference: { OTIO_SCHEMA: "ExternalReference.1", name: f.fileName, metadata: {}, available_range: range(0, total), target_url: url(f.fileName) },
    })),
  });
  // Pictures above sound, as editors lay them out.
  const ordered = [...t.files.filter((f) => f.kind !== "audio"), ...t.files.filter((f) => f.kind === "audio")];
  return `${JSON.stringify(
    {
      OTIO_SCHEMA: "Timeline.1",
      name: t.title,
      metadata: { tapry: { note: "Made by Tapry. Every file starts at the recording's start." } },
      global_start_time: null,
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "tracks",
        metadata: {},
        effects: [],
        source_range: null,
        markers: t.markers.map((m) => ({
          OTIO_SCHEMA: "Marker.2",
          name: m.label,
          color: "RED",
          metadata: {},
          marked_range: range(placed(Math.min(frames(m.atMs, t.frameRate), Math.max(0, total - 1)), segs), 1),
        })),
        children: ordered.map(track),
      },
    },
    null,
    2,
  )}\n`;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toFcpxml(t: TimelineInput): string {
  const { num, den } = fraction(t.frameRate);
  // One frame lasts den/num seconds; times are whole frames of that.
  const at = (frameCount: number) => `${frameCount * den}/${num}s`;
  const total = frames(t.durationMs, t.frameRate);
  const pictures = t.files.filter((f) => f.kind !== "audio");
  const sounds = t.files.filter((f) => f.kind === "audio");
  const all = [...pictures, ...sounds];
  if (all.length === 0) throw new ApiError(409, "nothing_to_export", "This recording has no files to put on a timeline");
  const id = (f: TimelineFile) => `r${all.indexOf(f) + 2}`;
  const asset = (f: TimelineFile) =>
    `    <asset id="${id(f)}" name="${xml(f.fileName.replace(/\.\w+$/, ""))}" start="0s" duration="${at(total)}" ${f.kind === "audio" ? 'hasAudio="1" audioSources="1" audioChannels="1" audioRate="48000"' : `hasVideo="1" format="r1"${f.kind === "video" ? ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' : ""}`}>\n` +
    `      <media-rep kind="original-media" src="./${url(f.fileName)}"/>\n    </asset>`;
  // The first file carries the others as connected clips: pictures stacked above, sound below.
  const [first, ...rest] = all;
  let up = 0;
  let down = 0;
  const lanes = rest.map((f) => ({ f, lane: f.kind === "audio" ? --down : ++up }));
  const segs = segments(t);
  const length = segs.reduce((n, s) => n + s.length, 0);
  // Each kept part is one clip of the first file on the spine, carrying the same part of every other file.
  const spine = segs.flatMap((seg) => [
    `          <asset-clip ref="${id(first!)}" offset="${at(seg.at)}" start="${at(seg.src)}" duration="${at(seg.length)}" name="${xml(trackName(first!))}">`,
    ...lanes.map(({ f, lane }) => `            <asset-clip ref="${id(f)}" lane="${lane}" offset="${at(seg.src)}" start="${at(seg.src)}" duration="${at(seg.length)}" name="${xml(trackName(f))}"/>`),
    ...t.markers
      .map((m) => Math.min(frames(m.atMs, t.frameRate), Math.max(0, total - 1)))
      .flatMap((frame, i) => (frame >= seg.src && frame < seg.src + seg.length ? [`            <marker start="${at(frame)}" duration="${at(1)}" value="${xml(t.markers[i]!.label)}"/>`] : [])),
    `          </asset-clip>`,
  ]);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.9">`,
    `  <resources>`,
    `    <format id="r1" name="FFVideoFormat1080p${t.frameRate.replace(".", "")}" frameDuration="${at(1)}" width="1920" height="1080"/>`,
    ...all.map(asset),
    `  </resources>`,
    `  <library>`,
    `    <event name="Tapry">`,
    `      <project name="${xml(t.title)}">`,
    `        <sequence format="r1" duration="${at(length)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
    ...spine,
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ``,
  ].join("\n");
}

export function toReaper(t: TimelineInput): string {
  const sounds = t.files.filter((f) => f.kind === "audio");
  if (sounds.length === 0) throw new ApiError(409, "nothing_to_export", "This recording has no audio files for a REAPER project");
  const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;
  // Sound has no frames: the kept parts are used to the millisecond.
  const parts: Array<{ src: number; at: number; length: number }> = [];
  for (const [from, to] of t.keep ?? [[0, t.durationMs]]) {
    const at = parts.length ? parts.at(-1)!.at + parts.at(-1)!.length : 0;
    if (to > from) parts.push({ src: from, at, length: to - from });
  }
  const seconds = (ms: number) => (ms / 1000).toFixed(6);
  const tracks = sounds.flatMap((f) => [
    `  <TRACK`,
    `    NAME ${quote(f.person)}`,
    ...parts.flatMap((p) => [
      `    <ITEM`,
      `      POSITION ${p.at === 0 ? "0" : seconds(p.at)}`,
      `      LENGTH ${seconds(p.length)}`,
      ...(p.src > 0 ? [`      SOFFS ${seconds(p.src)}`] : []),
      `      NAME ${quote(f.fileName)}`,
      `      <SOURCE ${f.fileName.toLowerCase().endsWith(".flac") ? "FLAC" : "WAVE"}`,
      `        FILE ${quote(f.fileName)}`,
      `      >`,
      `    >`,
    ]),
    `  >`,
  ]);
  const place = (ms: number) => {
    for (const p of parts) {
      if (ms < p.src) return p.at;
      if (ms < p.src + p.length) return p.at + (ms - p.src);
    }
    return parts.length ? parts.at(-1)!.at + parts.at(-1)!.length : ms;
  };
  const markers = t.markers.map((m, i) => `  MARKER ${i + 1} ${seconds(place(m.atMs))} ${quote(m.label)} 0`);
  return [`<REAPER_PROJECT 0.1 "7.0"`, `  SAMPLERATE 48000 0 0`, ...markers, ...tracks, `>`, ``].join("\n");
}

const MAKE: Record<TimelineFormat, (t: TimelineInput) => string> = { otio: toOtio, fcpxml: toFcpxml, rpp: toReaper };

/** Whose file this is, from its name ("Sam Guest - video.mp4"). */
const personOf = (fileName: string) => fileName.replace(/ - (audio|video|screen)\.\w+$/, "");

export class TimelineExports {
  constructor(private db: Db) {}

  /** What goes on a recording's timeline: its per-person files and its markers. */
  async input(user: User, studioId: string, recordingId: string): Promise<TimelineInput> {
    const [rec] = await this.db.query<{ number: number | null; started_at: number; stopped_at: number | null; studio: string; settings: unknown; processing: string }>(
      `SELECT r.number, r.started_at, r.stopped_at, r.processing, st.name AS studio, st.settings FROM recordings r
       JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [recordingId, studioId, user.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    if (rec.processing !== "ready" || rec.stopped_at === null) throw new ApiError(409, "not_ready", "The timeline is made once the recording's files are ready");
    const outputs = await this.db.query<{ kind: TimelineFile["kind"]; file_name: string; duration_ms: number | null }>(
      `SELECT o.kind, o.file_name, o.duration_ms FROM outputs o LEFT JOIN participants p ON p.id = o.participant_id
       WHERE o.recording_id = $1 AND o.kind IN ('audio', 'video', 'screen') AND o.file_name NOT LIKE '% - audio (original).%'
       ORDER BY p.created_at, o.kind`,
      [recordingId],
    );
    const markers = await this.db.query<{ at_ms: number; label: string }>("SELECT at_ms, label FROM markers WHERE recording_id = $1 ORDER BY at_ms, created_at", [recordingId]);
    // Every file has the recording's exact length; the files' own figure is the truth when they say.
    const durationMs = Math.max(...outputs.map((o) => Number(o.duration_ms ?? 0)), 0) || Math.max(1000, Number(rec.stopped_at) - Number(rec.started_at));
    return {
      title: `${rec.studio}${rec.number ? `, Recording ${rec.number}` : ""}`,
      durationMs,
      frameRate: studioSettings.parse(rec.settings).frameRate,
      files: outputs.map((o) => ({ fileName: o.file_name, kind: o.kind, person: personOf(o.file_name) })),
      markers: markers.map((m) => ({ atMs: Number(m.at_ms), label: m.label })),
    };
  }

  /** `speech` (when anyone is speaking): the timeline with long pauses left out, every track cut alike. */
  async file(user: User, studioId: string, recordingId: string, format: TimelineFormat, speech?: Array<[number, number]> | null) {
    const input = await this.input(user, studioId, recordingId);
    if (speech === undefined) return render(input, format);
    if (!speech) throw new ApiError(409, "no_transcript", "Pauses are found from the transcript, which isn't ready");
    const file = render({ ...input, keep: keepRanges(speech, input.durationMs) }, format);
    return { ...file, fileName: `Timeline (pauses removed).${format}` };
  }

  /** Every format this recording can have (a recording without audio files has no REAPER project), for the zip. */
  async all(user: User, studioId: string, recordingId: string) {
    const input = await this.input(user, studioId, recordingId).catch(() => null);
    if (!input || input.files.length === 0) return [];
    return TIMELINE_FORMATS.flatMap((format) => {
      try {
        return [render(input, format)];
      } catch {
        return [];
      }
    });
  }
}

function render(input: TimelineInput, format: TimelineFormat) {
  return { fileName: `Timeline.${format}`, contentType: CONTENT_TYPE[format], body: MAKE[format](input) };
}
