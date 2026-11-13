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
  const track = (f: TimelineFile) => ({
    OTIO_SCHEMA: "Track.1",
    name: trackName(f),
    kind: f.kind === "audio" ? "Audio" : "Video",
    metadata: {},
    effects: [],
    markers: [],
    source_range: null,
    children: [
      {
        OTIO_SCHEMA: "Clip.1",
        name: f.fileName,
        metadata: {},
        effects: [],
        markers: [],
        source_range: range(0, total),
        media_reference: { OTIO_SCHEMA: "ExternalReference.1", name: f.fileName, metadata: {}, available_range: range(0, total), target_url: url(f.fileName) },
      },
    ],
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
          marked_range: range(Math.min(frames(m.atMs, t.frameRate), Math.max(0, total - 1)), 1),
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
  const connected = rest.map((f) => {
    const lane = f.kind === "audio" ? --down : ++up;
    return `            <asset-clip ref="${id(f)}" lane="${lane}" offset="0s" start="0s" duration="${at(total)}" name="${xml(trackName(f))}"/>`;
  });
  const markers = t.markers.map((m) => `            <marker start="${at(Math.min(frames(m.atMs, t.frameRate), Math.max(0, total - 1)))}" duration="${at(1)}" value="${xml(m.label)}"/>`);
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
    `        <sequence format="r1" duration="${at(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
    `          <asset-clip ref="${id(first!)}" offset="0s" start="0s" duration="${at(total)}" name="${xml(trackName(first!))}">`,
    ...connected,
    ...markers,
    `          </asset-clip>`,
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
  const length = (t.durationMs / 1000).toFixed(6);
  const tracks = sounds.flatMap((f) => [
    `  <TRACK`,
    `    NAME ${quote(f.person)}`,
    `    <ITEM`,
    `      POSITION 0`,
    `      LENGTH ${length}`,
    `      NAME ${quote(f.fileName)}`,
    `      <SOURCE ${f.fileName.toLowerCase().endsWith(".flac") ? "FLAC" : "WAVE"}`,
    `        FILE ${quote(f.fileName)}`,
    `      >`,
    `    >`,
    `  >`,
  ]);
  const markers = t.markers.map((m, i) => `  MARKER ${i + 1} ${(m.atMs / 1000).toFixed(6)} ${quote(m.label)} 0`);
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

  async file(user: User, studioId: string, recordingId: string, format: TimelineFormat) {
    return render(await this.input(user, studioId, recordingId), format);
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
