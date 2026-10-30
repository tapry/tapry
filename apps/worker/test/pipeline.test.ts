// Runs against a real ffmpeg: set FFMPEG_PATH / FFPROBE_PATH, or have them on PATH.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FfmpegError, run } from "../src/ffmpeg.js";
import {
  alignmentFilters,
  concatChunks,
  findFont,
  gridLayout,
  loudnessGain,
  measureLoudness,
  PODCAST_LOUDNESS,
  renderRecording,
  type TrackInput,
} from "../src/pipeline.js";

const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
const hasFfmpeg = (() => {
  try {
    execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
    execFileSync(ffprobe, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("alignmentFilters", () => {
  it("pads a late track with silence / black and trims an early one", () => {
    const base = "aresample=48000,asetpts=N/SR/TB";
    expect(alignmentFilters("audio", 250)).toBe(`${base},adelay=250:all=1,apad`);
    expect(alignmentFilters("audio", -120)).toBe(`${base},atrim=start=0.120,asetpts=PTS-STARTPTS,apad`);
    expect(alignmentFilters("audio", 0)).toBe(`${base},apad`);
    expect(alignmentFilters("video", 1500)).toBe(
      "fps=30,tpad=start_duration=1.500:start_mode=add:color=black,tpad=stop=-1:stop_mode=clone",
    );
    expect(alignmentFilters("video", -40)).toBe("trim=start=0.040,setpts=PTS-STARTPTS,fps=30,tpad=stop=-1:stop_mode=clone");
  });
});

describe("gridLayout", () => {
  it("fits tiles in a 1920x1080 frame", () => {
    expect(gridLayout(1)).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }]);
    expect(gridLayout(2)).toEqual([
      { x: 0, y: 270, w: 960, h: 540 },
      { x: 960, y: 270, w: 960, h: 540 },
    ]);
    const four = gridLayout(4);
    expect(four.map((t) => [t.x, t.y])).toEqual([[0, 0], [960, 0], [0, 540], [960, 540]]);
    for (const n of [1, 2, 3, 4, 5, 8]) {
      for (const t of gridLayout(n)) {
        expect(t.x + t.w).toBeLessThanOrEqual(1920);
        expect(t.y + t.h).toBeLessThanOrEqual(1080);
        expect(t.w % 2 + (t.h % 2)).toBe(0); // H.264 needs even sizes
      }
    }
  });
});

describe("loudnessGain", () => {
  const target = PODCAST_LOUDNESS; // -16 LUFS, -1 dBTP, at most +20 dB

  it("raises a quiet track and lowers a loud one to the target", () => {
    expect(loudnessGain({ integrated: -28, truePeak: -18 }, target)).toBe(12);
    expect(loudnessGain({ integrated: -9.5, truePeak: -2 }, target)).toBe(-6.5);
  });

  it("raises less when the peaks would pass the ceiling (it never compresses or clips)", () => {
    // +12 dB wanted, but a -8 dBTP peak only has 7 dB of room under -1 dBTP.
    expect(loudnessGain({ integrated: -28, truePeak: -8 }, target)).toBe(7);
  });

  it("caps the boost, so a near-silent mic doesn't become loud hiss", () => {
    expect(loudnessGain({ integrated: -60, truePeak: -50 }, target)).toBe(20);
  });

  it("leaves silence alone", () => {
    expect(loudnessGain({ integrated: null, truePeak: null }, target)).toBe(0);
  });
});

describe.skipIf(!hasFfmpeg)("with ffmpeg", () => {
  let dir: string;
  let audioWebm: string;
  let videoWebm: string;

  /** Stand-ins for MediaRecorder output: Opus WebM (tone at ~1/4 full scale), and VP8 + Opus WebM. */
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "opentake-worker-test-"));
    audioWebm = join(dir, "audio.webm");
    videoWebm = join(dir, "video.webm");
    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
      "-af", "volume=4", "-c:a", "libopus", audioWebm]);
    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=3",
      "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "500k", "-c:a", "libopus", "-shortest", videoWebm]);
  });

  /** Split a file at arbitrary byte offsets, like MediaRecorder timeslices do. */
  function chunk(file: string, parts: number) {
    const data = readFileSync(file);
    const size = Math.ceil(data.length / parts);
    return Array.from({ length: parts }, (_, i) => {
      const p = join(dir, `${file.split("/").pop()}.${i}`);
      writeFileSync(p, data.subarray(i * size, (i + 1) * size));
      return p;
    });
  }

  const probe = (file: string, entries: string) =>
    execFileSync(ffprobe, ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file]).toString().trim();

  /** Mono 16-bit samples of a WAV: walk the RIFF chunks to "data" (ffmpeg adds a LIST chunk first). */
  function samples(file: string) {
    const buf = readFileSync(file);
    expect(buf.subarray(0, 4).toString()).toBe("RIFF");
    let at = 12;
    while (buf.subarray(at, at + 4).toString() !== "data") at += 8 + buf.readUInt32LE(at + 4);
    const start = at + 8;
    const end = start + buf.readUInt32LE(at + 4);
    return new Int16Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + end));
  }
  /** Loudest sample between two times (seconds). */
  const peak = (s: Int16Array, fromS: number, toS: number) => {
    let m = 0;
    for (let i = Math.round(fromS * 48000); i < Math.round(toS * 48000); i++) m = Math.max(m, Math.abs(s[i]!));
    return m;
  };

  it("rebuilds a chunked recording byte for byte", async () => {
    const out = join(dir, "rejoined.webm");
    await concatChunks(chunk(videoWebm, 7), out);
    expect(readFileSync(out).equals(readFileSync(videoWebm))).toBe(true);
  });

  it("renders aligned per-person WAV and MP4 plus a combined grid, all the same length", async () => {
    const rejoinedVideo = join(dir, "host-video.webm");
    const rejoinedAudio = join(dir, "host-audio.webm");
    await concatChunks(chunk(videoWebm, 5), rejoinedVideo);
    await concatChunks(chunk(audioWebm, 4), rejoinedAudio);

    const tracks: TrackInput[] = [
      // The host's recorder started 500 ms after Record; the guest's right on time.
      { trackId: "trk_host_a", participantId: "par_host", participantName: "Host", kind: "audio", rawPath: rejoinedAudio, offsetMs: 500 },
      { trackId: "trk_host_v", participantId: "par_host", participantName: "Host", kind: "video", rawPath: rejoinedVideo, offsetMs: 500 },
      { trackId: "trk_guest_a", participantId: "par_guest", participantName: "Sam/Guest", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
    ];
    const outputs = await renderRecording(tracks, { ffmpeg, ffprobe, workDir: join(dir, "out"), durationMs: 3000, videoHeight: 720 });

    expect(outputs.map((o) => [o.kind, o.fileName])).toEqual([
      ["audio", "Host - audio.wav"],
      ["video", "Host - video.mp4"],
      ["audio", "SamGuest - audio.wav"], // path separators removed
      ["combined", "Combined.mp4"],
    ]);
    for (const o of outputs) expect(Math.abs(o.durationMs! - 3000), o.fileName).toBeLessThan(80);

    // The late host track starts with exactly 500 ms of silence, then sound.
    const host = samples(outputs[0]!.path);
    expect(host.findIndex((x) => x !== 0)).toBeGreaterThanOrEqual(24_000 - 48); // within 1 ms of 0.5 s
    expect(host.findIndex((x) => x !== 0)).toBeLessThanOrEqual(24_000 + 48);
    expect(peak(host, 0.55, 1.5)).toBeGreaterThan(5000);
    // The on-time guest has sound from the start.
    const guest = samples(outputs[2]!.path);
    expect(peak(guest, 0, 0.1)).toBeGreaterThan(5000);
    // Every WAV is exactly the recording length, sample for sample.
    expect([host.length, guest.length]).toEqual([144_000, 144_000]);

    // Video: constant 30 fps H.264 at the studio height, with audio.
    expect(probe(outputs[1]!.path, "stream=codec_name,r_frame_rate,height").split("\n")).toEqual(
      expect.arrayContaining(["h264,720,30/1", "aac,0/0"]) // ffprobe prints fields in its own order,
    );
    // Combined: a full 1080p frame and mixed audio.
    expect(probe(outputs[3]!.path, "stream=codec_name,width,height").split("\n")).toEqual(
      expect.arrayContaining(["h264,1920,1080", "aac"]),
    );
  });

  it("levels everyone to podcast loudness, the video's sound and the combined mix too", async () => {
    // A quiet guest (about -32 LUFS), a louder host, and a guest whose mic was muted throughout.
    const quiet = join(dir, "quiet.webm");
    const silent = join(dir, "silent.webm");
    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=3", "-af", "volume=0.3", "-c:a", "libopus", quiet]);
    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "3", "-c:a", "libopus", silent]);
    const tracks: TrackInput[] = [
      { trackId: "trk_host_a", participantId: "par_host", participantName: "Host", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
      { trackId: "trk_host_v", participantId: "par_host", participantName: "Host", kind: "video", rawPath: videoWebm, offsetMs: 0 },
      { trackId: "trk_quiet", participantId: "par_quiet", participantName: "Quiet", kind: "audio", rawPath: quiet, offsetMs: 0 },
      { trackId: "trk_muted", participantId: "par_muted", participantName: "Muted", kind: "audio", rawPath: silent, offsetMs: 0 },
    ];
    const plain = await renderRecording(tracks, { ffmpeg, ffprobe, workDir: join(dir, "plain"), durationMs: 3000, videoHeight: 720 });
    const levelled = await renderRecording(tracks, {
      ffmpeg, ffprobe, workDir: join(dir, "levelled"), durationMs: 3000, videoHeight: 720, loudness: PODCAST_LOUDNESS,
    });
    const loudness = async (o: { path: string }) => measureLoudness(ffmpeg, o.path);
    const byName = (list: typeof levelled, name: string) => list.find((o) => o.fileName === name)!;

    // Off (the default): files are as recorded.
    expect((await loudness(byName(plain, "Quiet - audio.wav"))).integrated).toBeLessThan(-30);
    expect(plain.every((o) => o.gainDb === undefined)).toBe(true);

    // On: each voice lands on -16 LUFS, with its peaks under the -1 dBTP ceiling.
    for (const name of ["Host - audio.wav", "Quiet - audio.wav"]) {
      const m = await loudness(byName(levelled, name));
      expect(m.integrated!, name).toBeCloseTo(-16, 0);
      expect(m.truePeak!, name).toBeLessThanOrEqual(-0.9);
    }
    expect(byName(levelled, "Quiet - audio.wav").gainDb).toBeGreaterThan(15);
    // Silence stays silence: no gain, nothing amplified.
    expect(byName(levelled, "Muted - audio.wav").gainDb).toBe(0);
    expect((await loudness(byName(levelled, "Muted - audio.wav"))).integrated).toBeNull();

    // The host's video gets the host's gain, so it sounds like their WAV.
    const hostGain = byName(levelled, "Host - audio.wav").gainDb!;
    expect(byName(levelled, "Host - video.mp4").gainDb).toBe(hostGain);
    const videoBefore = (await loudness(byName(plain, "Host - video.mp4"))).integrated!;
    const videoAfter = (await loudness(byName(levelled, "Host - video.mp4"))).integrated!;
    expect(videoAfter - videoBefore).toBeCloseTo(hostGain, 0);

    // The combined mix is levelled as a whole, not just the sum of levelled voices.
    const combined = await loudness(byName(levelled, "Combined.mp4"));
    expect(combined.integrated!).toBeCloseTo(-16, 0);
    expect(combined.truePeak!).toBeLessThanOrEqual(-0.5); // AAC adds a little overshoot

    // Still exactly the recording length.
    expect(samples(byName(levelled, "Quiet - audio.wav").path).length).toBe(144_000);
  });

  it("merges the pieces of someone who rejoined mid-recording into one file each, gap included", async () => {
    // Recording of 6 s: the guest's tab died at ~3 s and they were back at 4 s.
    const pieces: TrackInput[] = [
      { trackId: "trk_a1", participantId: "par_g", participantName: "Sam", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
      { trackId: "trk_a2", participantId: "par_g", participantName: "Sam", kind: "audio", rawPath: audioWebm, offsetMs: 4000 },
      { trackId: "trk_v1", participantId: "par_g", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 0 },
      { trackId: "trk_v2", participantId: "par_g", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 4000 },
    ];
    const outputs = await renderRecording(pieces, { ffmpeg, ffprobe, workDir: join(dir, "rejoin"), durationMs: 6000, videoHeight: 720 });
    expect(outputs.map((o) => o.fileName)).toEqual(["Sam - audio.wav", "Sam - video.mp4", "Combined.mp4"]);
    for (const o of outputs) expect(Math.abs(o.durationMs! - 6000), o.fileName).toBeLessThan(80);

    const audio = samples(outputs[0]!.path);
    expect(audio.length).toBe(6 * 48000);
    expect(peak(audio, 0.1, 2.9)).toBeGreaterThan(5000); // first piece
    expect(peak(audio, 3.1, 3.9)).toBeLessThan(100); // the gap is silent
    expect(peak(audio, 4.1, 5.9)).toBeGreaterThan(5000); // second piece, in its place

    // Video brightness: the test pattern while each piece records, black in the gap.
    const brightness = (t: number) =>
      Number.parseFloat(
        execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", outputs[1]!.path, "-frames:v", "1",
          "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"])
          .toString().match(/YAVG=([\d.]+)/)![1]!,
      );
    expect(brightness(1.5)).toBeGreaterThan(40);
    expect(brightness(3.5)).toBeLessThan(20);
    expect(brightness(5)).toBeGreaterThan(40);
  });

  it("levels a rejoined person's merged pieces with one gain, gap still silent", async () => {
    const pieces: TrackInput[] = [
      { trackId: "trk_a1", participantId: "par_g", participantName: "Sam", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
      { trackId: "trk_a2", participantId: "par_g", participantName: "Sam", kind: "audio", rawPath: audioWebm, offsetMs: 4000 },
      { trackId: "trk_v1", participantId: "par_g", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 0 },
      { trackId: "trk_v2", participantId: "par_g", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 4000 },
    ];
    const opts = { ffmpeg, ffprobe, durationMs: 6000, videoHeight: 720 as const };
    const plain = await renderRecording(pieces, { ...opts, workDir: join(dir, "rejoin-plain") });
    const levelled = await renderRecording(pieces, { ...opts, workDir: join(dir, "rejoin-levelled"), loudness: PODCAST_LOUDNESS });

    expect((await measureLoudness(ffmpeg, levelled[0]!.path)).integrated!).toBeCloseTo(-16, 0);
    const audio = samples(levelled[0]!.path);
    expect(audio.length).toBe(6 * 48000);
    expect(peak(audio, 3.1, 3.9)).toBeLessThan(100); // the gap is not raised into noise

    const gain = levelled[0]!.gainDb!;
    expect(levelled[1]!.gainDb).toBe(gain);
    const before = (await measureLoudness(ffmpeg, plain[1]!.path)).integrated!;
    const after = (await measureLoudness(ffmpeg, levelled[1]!.path)).integrated!;
    expect(after - before).toBeCloseTo(gain, 0);
  });

  it("writes each person's name on their tile of the combined video, whatever characters it has", async () => {
    const font = await findFont();
    expect(font, "a font for drawtext").toBeTruthy();
    const people: TrackInput[] = [
      { trackId: "trk_v", participantId: "par_1", participantName: "Host", kind: "video", rawPath: videoWebm, offsetMs: 0 },
      { trackId: "trk_a", participantId: "par_1", participantName: "Host", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
      // Audio-only guest whose name would break a naive filter string.
      { trackId: "trk_g", participantId: "par_2", participantName: `Zoë "O'Brien": 100% \\ yes`, kind: "audio", rawPath: audioWebm, offsetMs: 0 },
    ];
    const render = async (f: string | null, name: string) =>
      (await renderRecording(people, { ffmpeg, ffprobe, workDir: join(dir, name), durationMs: 2000, videoHeight: 720, font: f })).find(
        (o) => o.kind === "combined",
      )!.path;
    const labelled = await render(font, "labels");
    const plain = await render(null, "no-labels");

    // Brightest pixel of a region of the frame at 1 s (white text vs the dark tile background).
    const brightest = (file: string, crop: string) =>
      Number.parseFloat(
        execFileSync(ffmpeg, ["-v", "error", "-ss", "1", "-i", file, "-frames:v", "1",
          "-vf", `crop=${crop},signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-`, "-f", "null", "-"])
          .toString().match(/YMAX=([\d.]+)/)![1]!,
      );
    // Two tiles side by side (960x540 at y=270): the host's name bottom-left of the left tile,
    // the guest's name centred on the right (dark, audio-only) tile.
    // The host's 4:3 camera is pillarboxed in its 16:9 tile, so its tag lands on the dark margin.
    const hostTag = "110:50:4:755";
    const guestName = "560:60:1150:505";
    for (const region of [hostTag, guestName]) {
      expect(brightest(plain, region), `no text at ${region} without names`).toBeLessThan(60);
      expect(brightest(labelled, region), `text at ${region}`).toBeGreaterThan(180);
    }
  });

  it("gives two people with the same name distinct files", async () => {
    const tracks: TrackInput[] = ["par_1", "par_2"].map((pid, i) => ({
      trackId: `trk_${i}`, participantId: pid, participantName: "Sam", kind: "audio", rawPath: audioWebm, offsetMs: 0,
    }));
    const outputs = await renderRecording(tracks, { ffmpeg, ffprobe, workDir: join(dir, "dupes"), durationMs: 1000, videoHeight: 720 });
    expect(outputs.map((o) => o.fileName)).toEqual(["Sam - audio.wav", "Sam (2) - audio.wav", "Combined.mp4"]);
  });

  it("reports ffmpeg's reason when the input is not media", async () => {
    const junk = join(dir, "junk.webm");
    writeFileSync(junk, "definitely not a webm file");
    const err = await renderRecording(
      [{ trackId: "trk_x", participantId: "par_x", participantName: "X", kind: "audio", rawPath: junk, offsetMs: 0 }],
      { ffmpeg, ffprobe, workDir: join(dir, "junk"), durationMs: 1000, videoHeight: 720 },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FfmpegError);
    expect(err.stderrTail).toMatch(/Invalid data|could not find|EBML/i);
  });
});
