// Runs against a real ffmpeg: set FFMPEG_PATH / FFPROBE_PATH, or have them on PATH.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_FILTERS, type TrackFilters } from "@tapry/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { FfmpegError, run } from "../src/ffmpeg.js";
import {
  alignmentFilters,
  audioCleanFilters,
  backgroundBlurGraph,
  concatChunks,
  filterDelaySamples,
  measureNoiseFloor,
  findFont,
  gridLayout,
  loudnessGain,
  measureLoudness,
  PODCAST_LOUDNESS,
  renderRecording,
  type FilterFailure,
  type SkippedTrack,
  type TrackInput,
  VIDEO_MAX_BITRATE,
  videoLookFilters,
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

describe("filters as ffmpeg chains", () => {
  const with_ = (f: Partial<TrackFilters>): TrackFilters => ({ ...NO_FILTERS, ...f });

  it("adds nothing at all when a person chose no filters, so the command is what it always was", () => {
    expect(videoLookFilters(undefined)).toBe("");
    expect(videoLookFilters(NO_FILTERS)).toBe("");
    expect(videoLookFilters(with_({ noiseRemoval: true }))).toBe(""); // sound only
    expect(audioCleanFilters(undefined)).toBe("");
    expect(audioCleanFilters(NO_FILTERS)).toBe("");
    expect(audioCleanFilters(with_({ brightness: 2, look: "mono", touchUp: true }))).toBe(""); // picture only
  });

  it("writes each setting from the shared tables", () => {
    expect(videoLookFilters(with_({ brightness: 1 }))).toBe("eq=brightness=0.04:contrast=1.03:gamma=1.15:saturation=1");
    expect(videoLookFilters(with_({ brightness: 2 }))).toBe("eq=brightness=0.08:contrast=1.06:gamma=1.35:saturation=1");
    expect(videoLookFilters(with_({ look: "warm" }))).toBe("eq=brightness=0:contrast=1:gamma=1:saturation=1.08,colortemperature=temperature=5200");
    expect(videoLookFilters(with_({ look: "cool" }))).toBe("eq=brightness=0:contrast=1:gamma=1:saturation=1.02,colortemperature=temperature=8200");
    // Black and white: no colour left to warm or cool.
    expect(videoLookFilters(with_({ look: "mono" }))).toBe("eq=brightness=0:contrast=1:gamma=1:saturation=0");
    expect(videoLookFilters(with_({ touchUp: true }))).toBe("bilateral=sigmaS=3:sigmaR=0.05:planes=1");
    expect(videoLookFilters({ ...NO_FILTERS, brightness: 2, look: "warm", touchUp: true, noiseRemoval: true })).toBe(
      "eq=brightness=0.08:contrast=1.06:gamma=1.35:saturation=1.08,colortemperature=temperature=5200,bilateral=sigmaS=3:sigmaR=0.05:planes=1",
    );
  });

  it("blurs the background in a graph that leaves the camera's own path as it is", () => {
    expect(videoLookFilters(with_({ background: "blur" }))).toBe(""); // the blur isn't a look: it needs the mask
    const align = alignmentFilters("video", 500);
    expect(backgroundBlurGraph({ look: "", align, scale: "scale=-2:1080", frame: "", maskOffsetMs: 520, height: 1080 })).toBe(
      [
        `[0:v]${align},scale=-2:1080,format=yuv420p,split[sharp][soft]`,
        "[soft]gblur=sigma=20[bg]",
        "[1:v]format=gray,fps=30:start_time=0,tpad=start_duration=0.520:start_mode=add:color=black,tpad=stop=-1:stop_mode=add:color=black,lut=y='clip((val-64)*2,0,255)'[mask]",
        "[mask][sharp]scale2ref=flags=bilinear[fit][person]",
        "[fit]gblur=sigma=4[edge]",
        "[person][edge]alphamerge[fg]",
        "[bg][fg]overlay=format=yuv420,format=yuv420p[v]",
      ].join(";"),
    );
    // A mask that began before Record is trimmed like a track; the blur scales with the picture.
    const early = backgroundBlurGraph({ look: "eq=saturation=0", align, scale: "scale=-2:720", frame: "pad=1280:720", maskOffsetMs: -40, height: 720 });
    expect(early).toContain(`[0:v]eq=saturation=0,${align},scale=-2:720,format=yuv420p,split`);
    expect(early).toContain("[1:v]format=gray,trim=start=0.040,setpts=PTS-STARTPTS,fps=30:start_time=0,tpad=stop=-1:stop_mode=add:color=black,lut=");
    expect(early).toContain("gblur=sigma=13.333[bg]");
    expect(early).toContain("overlay=format=yuv420,pad=1280:720,format=yuv420p[v]");
  });

  it("sets noise removal by the track's own noise floor, and takes the filter's delay off again", () => {
    const on = with_({ noiseRemoval: true });
    expect(audioCleanFilters(on)).toBe("afftdn=nr=12:nf=-50"); // nothing measured: a usual room
    expect(audioCleanFilters(on, { noiseFloorDb: -56.2 })).toBe("afftdn=nr=12:nf=-36");
    expect(audioCleanFilters(on, { noiseFloorDb: -56.2, delaySamples: 1200 })).toBe(
      "apad=pad_len=1200,afftdn=nr=12:nf=-36,atrim=start_sample=1200,asetpts=N/SR/TB",
    );
    // Someone talking throughout has no quiet stretch: their voice isn't taken for noise.
    expect(audioCleanFilters(on, { noiseFloorDb: -20 })).toBe("afftdn=nr=12:nf=-25");
    expect(audioCleanFilters(on, { noiseFloorDb: -110 })).toBe("afftdn=nr=12:nf=-80");
    expect(audioCleanFilters(on, { noiseFloorDb: null })).toBe("afftdn=nr=12:nf=-50");
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
    dir = mkdtempSync(join(tmpdir(), "tapry-worker-test-"));
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

  it("mixes everyone into one WAV instead of a video when nobody had a camera (audio only)", async () => {
    const tracks: TrackInput[] = [
      { trackId: "trk_a", participantId: "par_a", participantName: "Ana", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
      { trackId: "trk_b", participantId: "par_b", participantName: "Ben", kind: "audio", rawPath: audioWebm, offsetMs: 1000 },
    ];
    const progress: string[] = [];
    const outputs = await renderRecording(tracks, {
      ffmpeg, ffprobe, workDir: join(dir, "audio-only"), durationMs: 3000, videoHeight: 720, loudness: PODCAST_LOUDNESS,
      onProgress: (p) => progress.push(`${p.done}/${p.total} ${p.current}`),
    });
    // Told before each file, so the host can see which one it's on.
    expect(progress).toEqual(["0/3 Ana's audio", "1/3 Ben's audio", "2/3 Everyone, mixed"]);
    expect(outputs.map((o) => [o.kind, o.fileName, o.contentType])).toEqual([
      ["audio", "Ana - audio.wav", "audio/wav"],
      ["audio", "Ben - audio.wav", "audio/wav"],
      ["combined", "Combined.wav", "audio/wav"],
    ]);
    const mix = samples(outputs[2]!.path);
    expect(mix.length).toBe(144_000); // exactly the recording length
    // Ana from the start, both together after Ben's 1 s offset: the mix gets louder there.
    expect(peak(mix, 0.1, 0.9)).toBeGreaterThan(1000);
    expect(peak(mix, 1.1, 2.9)).toBeGreaterThan(peak(mix, 0.1, 0.9));
    expect(outputs[2]!.gainDb).toBeTypeOf("number");
  });

  it("writes FLAC instead of WAV when asked: the same samples, losslessly", async () => {
    const tracks: TrackInput[] = [
      { trackId: "trk_a", participantId: "par_a", participantName: "Ana", kind: "audio", rawPath: audioWebm, offsetMs: 0 },
      { trackId: "trk_b", participantId: "par_b", participantName: "Ben", kind: "audio", rawPath: audioWebm, offsetMs: 500 },
    ];
    const opts = { ffmpeg, ffprobe, durationMs: 3000, videoHeight: 720 as const, loudness: PODCAST_LOUDNESS };
    const wav = await renderRecording(tracks, { ...opts, workDir: join(dir, "as-wav") });
    const flac = await renderRecording(tracks, { ...opts, workDir: join(dir, "as-flac"), audioFormat: "flac" });
    expect(flac.map((o) => [o.fileName, o.contentType])).toEqual([
      ["Ana - audio.flac", "audio/flac"],
      ["Ben - audio.flac", "audio/flac"],
      ["Combined.flac", "audio/flac"],
    ]);
    for (const [i, f] of flac.entries()) {
      expect(probe(f.path, "stream=codec_name")).toBe("flac");
      const decoded = join(dir, `decoded-${i}.wav`);
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", f.path, "-c:a", "pcm_s16le", decoded]);
      expect(Buffer.from(samples(decoded).buffer).equals(Buffer.from(samples(wav[i]!.path).buffer)), f.fileName).toBe(true);
      expect(f.gainDb).toBe(wav[i]!.gainDb); // levelled the same
    }
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

  it("never makes a person's video bigger than what they recorded (bitrate capped)", { timeout: 120_000 }, async () => {
    // Noisy 1080p at the recorder's 8 Mbit/s: uncapped, CRF 20 spent ~10.5 Mbit/s on this.
    const noisy = join(dir, "noisy.webm");
    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30,noise=alls=10:allf=t+u", "-t", "10",
      "-c:v", "libvpx-vp9", "-b:v", "8M", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-an", noisy]);
    const [video] = await renderRecording(
      [{ trackId: "v", participantId: "p", participantName: "Sam", kind: "video", rawPath: noisy, offsetMs: 0 }],
      { ffmpeg, ffprobe, workDir: join(dir, "capped"), durationMs: 10_000, videoHeight: 1080 },
    );
    const bitrate = Number(probe(video!.path, "stream=bit_rate").split("\n")[0]);
    expect(bitrate).toBeLessThan(VIDEO_MAX_BITRATE[1080] * 1.1);
    expect(probe(video!.path, "stream=height").split("\n")[0]).toBe("1080");
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
    expect(outputs.map((o) => o.fileName)).toEqual(["Sam - audio.wav", "Sam (2) - audio.wav", "Combined.wav"]);
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

  describe("when a track is damaged", () => {
    const track = (over: Partial<TrackInput>): TrackInput => ({
      trackId: "trk",
      participantId: "good",
      participantName: "Good",
      kind: "audio",
      rawPath: audioWebm,
      offsetMs: 0,
      ...over,
    });
    const junk = () => {
      const path = join(dir, "junk.raw");
      writeFileSync(path, "this is not media at all".repeat(100));
      return path;
    };
    const render = (tracks: TrackInput[], name: string) => {
      const skipped: SkippedTrack[] = [];
      const outputs = renderRecording(tracks, {
        ffmpeg, ffprobe, workDir: join(dir, name), durationMs: 3000, videoHeight: 720, onSkipped: (s) => skipped.push(s),
      });
      return { outputs, skipped };
    };

    it("renders everyone else and says who was left out", async () => {
      const run = render([track({}), track({ trackId: "bad", participantId: "bad", participantName: "Bad", rawPath: junk() })], "one-bad");
      const names = (await run.outputs).map((o) => o.fileName);
      expect(names).toEqual(["Good - audio.wav", "Combined.wav"]);
      expect(run.skipped).toEqual([expect.objectContaining({ trackId: "bad", participantName: "Bad", kind: "audio", reason: expect.any(String) })]);
    });

    it("keeps the readable piece when one of a person's pieces is damaged", async () => {
      const run = render([track({ trackId: "a" }), track({ trackId: "b", rawPath: junk() })], "one-piece");
      expect((await run.outputs).map((o) => o.fileName)).toEqual(["Good - audio.wav", "Combined.wav"]);
      expect(run.skipped.map((s) => s.trackId)).toEqual(["b"]);
    });

    it("keeps the readable piece of a person's video too (one piece: nothing to blend)", async () => {
      const run = render([track({ trackId: "v1", kind: "video", rawPath: videoWebm }), track({ trackId: "v2", kind: "video", rawPath: junk() })], "video-piece");
      const outputs = await run.outputs;
      expect(outputs.map((o) => o.fileName)).toEqual(["Good - video.mp4", "Combined.mp4"]);
      expect(probe(outputs[0]!.path, "stream=codec_type")).toContain("audio");
      expect(run.skipped.map((s) => s.trackId)).toEqual(["v2"]);
    });

    it("fails when nothing can be read, which is more likely the machine than the media", async () => {
      await expect(render([track({ rawPath: junk() })], "all-bad").outputs).rejects.toBeInstanceOf(FfmpegError);
    });

    it("keeps what follows a lost chunk in place, instead of pulling it earlier", async () => {
      // A beep every 2 s, so every position after the gap is checkable.
      const source = join(dir, "beeps.webm");
      await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,2),0.2),0.3*sin(2*PI*440*t),0)':s=48000:d=30",
        "-c:a", "libopus", "-b:a", "128k", "-vbr", "off", source]);
      const parts = chunk(source, 8);
      const gapped = join(dir, "gapped.raw");
      await concatChunks(parts.filter((_, i) => i !== 3), gapped);
      const beeps = (file: string) => {
        const s = samples(file);
        const found: number[] = [];
        for (let i = 0, last = -1; i < s.length; i++) {
          if (Math.abs(s[i]!) > 3000 && (last < 0 || i - last > 48000)) {
            found.push(i / 48000);
            last = i;
          } else if (Math.abs(s[i]!) > 3000) last = i;
        }
        return found;
      };
      const opts = { ffmpeg, ffprobe, durationMs: 30_000, videoHeight: 720 as const };
      const [repaired] = await renderRecording([track({ rawPath: gapped, hasGaps: true })], { ...opts, workDir: join(dir, "gap-fixed") });
      const after = beeps(repaired!.path).filter((t) => t > 11);
      expect(after.length).toBeGreaterThan(3); // the gap itself is silent, then the beeps return
      for (const t of after) expect(Math.abs(t - Math.round(t / 2) * 2)).toBeLessThan(0.05); // still on the 2-second marks
      // Without the flag, this is what happens: everything after the gap lands off the marks.
      const [shifted] = await renderRecording([track({ rawPath: gapped })], { ...opts, workDir: join(dir, "gap-shifted") });
      const off = beeps(shifted!.path).filter((t) => t > 11);
      expect(off.some((t) => Math.abs(t - Math.round(t / 2) * 2) > 0.2)).toBe(true);
    });
  });
  describe("filters", () => {
    const with_ = (f: Partial<TrackFilters>): TrackFilters => ({ ...NO_FILTERS, ...f });
    /** A picture statistic (signalstats: YAVG light, SATAVG colourfulness, UAVG / VAVG tint) of the frame at `t` seconds. */
    const stat = (file: string, key: string, t = 1.5) =>
      Number.parseFloat(
        execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
          "-vf", `signalstats,metadata=print:key=lavfi.signalstats.${key}:file=-`, "-f", "null", "-"])
          .toString().match(new RegExp(`${key}=([\\d.]+)`))![1]!,
      );
    const rms = (s: Int16Array, fromS: number, toS: number) => {
      let sum = 0;
      const a = Math.round(fromS * 48000);
      const b = Math.round(toS * 48000);
      for (let i = a; i < b; i++) sum += s[i]! * s[i]!;
      return Math.sqrt(sum / (b - a));
    };
    const video = (filters?: TrackFilters, offsetMs = 0): TrackInput =>
      ({ trackId: "trk_v", participantId: "par_s", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs, filters });
    const renderVideo = async (name: string, filters?: TrackFilters, offsetMs = 0) =>
      (await renderRecording([video(filters, offsetMs)], { ffmpeg, ffprobe, workDir: join(dir, name), durationMs: 3000, videoHeight: 720 }))[0]!;
    /** What must not change, whatever the filters: size, frame rate, frame count, length. */
    const shape = (file: string) => probe(file, "stream=codec_name,width,height,r_frame_rate,nb_frames");

    let plain: Awaited<ReturnType<typeof renderVideo>>;
    beforeAll(async () => {
      plain = await renderVideo("look-plain");
    });

    it("makes the picture black and white, brighter, warmer or cooler, in the same frame and length", async () => {
      const mono = await renderVideo("look-mono", with_({ look: "mono" }));
      expect(stat(plain.path, "SATAVG")).toBeGreaterThan(20); // the test pattern is colourful
      expect(stat(mono.path, "SATAVG")).toBeLessThan(1.5);

      const bright = await renderVideo("look-bright", with_({ brightness: 2 }));
      const brighter = await renderVideo("look-brighter", with_({ brightness: 1 }));
      expect(stat(brighter.path, "YAVG")).toBeGreaterThan(stat(plain.path, "YAVG") + 3);
      expect(stat(bright.path, "YAVG")).toBeGreaterThan(stat(brighter.path, "YAVG") + 3);

      // Warm leans red (V up, U down), cool leans blue.
      const warm = await renderVideo("look-warm", with_({ look: "warm" }));
      const cool = await renderVideo("look-cool", with_({ look: "cool" }));
      expect(stat(warm.path, "VAVG")).toBeGreaterThan(stat(cool.path, "VAVG") + 2);
      expect(stat(warm.path, "UAVG")).toBeLessThan(stat(cool.path, "UAVG") - 2);

      for (const o of [mono, bright, brighter, warm, cool]) {
        expect(shape(o.path), o.path).toBe(shape(plain.path));
        expect(o.durationMs).toBe(plain.durationMs);
        expect(o.fileName).toBe("Sam - video.mp4");
      }
    });

    it("touch-up smooths the picture a little and keeps its size and length", async () => {
      // A grainy camera: the test pattern with noise, which is what smoothing evens out.
      const grainy = join(dir, "grainy.webm");
      await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=3,noise=alls=14:allf=t",
        "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "3M", "-an", grainy]);
      const render = async (name: string, filters?: TrackFilters) =>
        (await renderRecording([{ ...video(filters), rawPath: grainy }], { ffmpeg, ffprobe, workDir: join(dir, name), durationMs: 3000, videoHeight: 720 }))[0]!;
      const before = await render("touch-off");
      const after = await render("touch-on", with_({ touchUp: true }));
      const psnr = Number.parseFloat(
        (await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", after.path, "-i", before.path, "-lavfi", "psnr", "-f", "null", "-"], { stderr: true }))
          .match(/average:([\d.]+|inf)/)![1]!.replace("inf", "Infinity"),
      );
      expect(psnr).toBeLessThan(45); // it changed the picture...
      expect(psnr).toBeGreaterThan(24); // ...gently
      expect(shape(after.path)).toBe(shape(before.path));
      expect(after.durationMs).toBe(before.durationMs);
    });

    it("keeps the black before a late start black, and the picture where it belongs", async () => {
      const late = await renderVideo("look-late", with_({ brightness: 2, look: "warm", touchUp: true }), 1000);
      const latePlain = await renderVideo("look-late-plain", undefined, 1000);
      expect(stat(late.path, "YAVG", 0.5)).toBeLessThan(20); // not lifted to grey
      expect(stat(late.path, "YAVG", 0.5)).toBe(stat(latePlain.path, "YAVG", 0.5));
      expect(stat(late.path, "YAVG", 1.5)).toBeGreaterThan(stat(latePlain.path, "YAVG", 1.5) + 3);
      expect(shape(late.path)).toBe(shape(latePlain.path));
      expect(Math.abs(late.durationMs! - 3000)).toBeLessThan(80);
    });

    it("shows the filtered picture in the combined video too", async () => {
      const tracks = (filters?: TrackFilters): TrackInput[] => [video(filters)];
      const opts = { ffmpeg, ffprobe, durationMs: 3000, videoHeight: 720 as const, font: null };
      const colour = (await renderRecording(tracks(), { ...opts, workDir: join(dir, "grid-plain") })).find((o) => o.kind === "combined")!;
      const mono = (await renderRecording(tracks(with_({ look: "mono" })), { ...opts, workDir: join(dir, "grid-mono") })).find((o) => o.kind === "combined")!;
      expect(stat(colour.path, "SATAVG")).toBeGreaterThan(20);
      expect(stat(mono.path, "SATAVG")).toBeLessThan(1.5);
    });

    describe("noise removal", () => {
      let noisy: string;
      const audio = (filters?: TrackFilters, offsetMs = 0): TrackInput =>
        ({ trackId: "trk_a", participantId: "par_s", participantName: "Sam", kind: "audio", rawPath: noisy, offsetMs, filters });
      const opts = (name: string) => ({ ffmpeg, ffprobe, workDir: join(dir, name), durationMs: 6000, videoHeight: 720 as const });
      /** First sample of the tone (well above the noise). */
      const onset = (s: Int16Array) => s.findIndex((x) => Math.abs(x) > 6000);

      // A voice stand-in (a tone for 2 s) over steady hiss that goes on for 6 s.
      beforeAll(async () => {
        noisy = join(dir, "noisy.webm");
        await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
          "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.008:sample_rate=48000:duration=6:seed=7",
          "-filter_complex", "[0:a]volume=3,apad=whole_dur=6[t];[t][1:a]amix=inputs=2:normalize=0[a]", "-map", "[a]",
          "-c:a", "libopus", "-b:a", "128k", noisy]);
      });

      it("lowers the noise floor, keeps the voice, and keeps the sound as recorded next to it", async () => {
        const asRecorded = await renderRecording([audio()], opts("noise-off"));
        const outputs = await renderRecording([audio(with_({ noiseRemoval: true }))], opts("noise-on"));
        expect(outputs.map((o) => [o.kind, o.fileName])).toEqual([
          ["audio", "Sam - audio.wav"],
          ["audio", "Sam - audio (original).wav"],
          ["combined", "Combined.wav"],
        ]);
        const cleaned = samples(outputs[0]!.path);
        const original = samples(outputs[1]!.path);
        // The hiss alone (after the tone): at least 6 dB quieter.
        expect(rms(original, 4, 5.5)).toBeGreaterThan(30);
        expect(rms(cleaned, 4, 5.5)).toBeLessThan(rms(original, 4, 5.5) / 2);
        // The tone is still there at its level.
        expect(peak(cleaned, 0.5, 1.5) / peak(original, 0.5, 1.5)).toBeGreaterThan(0.8);
        expect(peak(cleaned, 0.5, 1.5) / peak(original, 0.5, 1.5)).toBeLessThan(1.1);
        // The original is sample for sample what a render without filters gives.
        expect(Buffer.from(original.buffer).equals(Buffer.from(samples(asRecorded[0]!.path).buffer))).toBe(true);
        expect(outputs[1]).toMatchObject({ original: true, participantId: "par_s", trackId: "trk_a", contentType: "audio/wav" });
        // Same length, to the sample; and the mix is the cleaned sound, not the original.
        expect([cleaned.length, original.length]).toEqual([288_000, 288_000]);
        expect(Buffer.from(samples(outputs[2]!.path).buffer).equals(Buffer.from(cleaned.buffer))).toBe(true);
      });

      it("measures the hiss between words as the noise floor, and how long this ffmpeg's filter holds sound back", async () => {
        const [late] = await renderRecording([audio(undefined, 500)], opts("noise-floor"));
        const floor = (await measureNoiseFloor(late!.path))!;
        expect(floor).toBeGreaterThan(-62); // pink noise at about -56 dBFS; the 500 ms of padding isn't counted
        expect(floor).toBeLessThan(-50);
        const silent = join(dir, "digital-silence.wav");
        await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1", "-c:a", "pcm_s16le", silent]);
        expect(await measureNoiseFloor(silent)).toBeNull();
        const delay = await filterDelaySamples(ffmpeg, "afftdn=nr=12:nf=-50", dir);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(4800);
        expect(await filterDelaySamples(ffmpeg, "anull", dir)).toBe(0);
      });

      it("doesn't move the sound: a late track's voice starts where it does without filters", async () => {
        const asRecorded = samples((await renderRecording([audio(undefined, 500)], opts("noise-late-off")))[0]!.path);
        const cleaned = samples((await renderRecording([audio(with_({ noiseRemoval: true }), 500)], opts("noise-late-on")))[0]!.path);
        expect(cleaned.length).toBe(288_000);
        expect(onset(asRecorded)).toBeGreaterThan(24_000 - 48);
        // ffmpeg 6.0's afftdn alone would bring it 25 ms late: that is measured and taken off.
        expect(Math.abs(onset(cleaned) - onset(asRecorded))).toBeLessThanOrEqual(24); // within half a millisecond
        expect(peak(cleaned, 0, 0.45)).toBeLessThan(50); // the silence before it is still silence
      });

      it("levels the cleaned sound, not the noisy one, and leaves the original as recorded", async () => {
        const plainLevel = await renderRecording([audio()], { ...opts("noise-level-off"), loudness: PODCAST_LOUDNESS });
        const outputs = await renderRecording([audio(with_({ noiseRemoval: true }))], { ...opts("noise-level-on"), loudness: PODCAST_LOUDNESS, audioFormat: "flac" });
        expect(outputs.map((o) => o.fileName)).toEqual(["Sam - audio.flac", "Sam - audio (original).flac", "Combined.flac"]);
        expect((await measureLoudness(ffmpeg, outputs[0]!.path)).integrated!).toBeCloseTo(-16, 0);
        // Less hiss counted as loudness, so the voice is raised a little more than with the hiss in.
        expect(outputs[0]!.gainDb!).toBeGreaterThanOrEqual(plainLevel[0]!.gainDb!);
        expect(outputs[1]!.gainDb).toBeUndefined();
        expect(outputs[1]!.contentType).toBe("audio/flac");
      });

      it("cleans the sound in the person's video as well", async () => {
        const cam = join(dir, "noisy-cam.webm");
        await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=6", "-i", noisy,
          "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "500k", "-c:a", "copy", "-shortest", cam]);
        const render = async (name: string, filters?: TrackFilters) => {
          const [out] = await renderRecording([{ ...video(filters), rawPath: cam }], opts(name));
          const wav = join(dir, `${name}.wav`);
          await run(ffmpeg, ["-y", "-i", out!.path, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
          return { out: out!, sound: samples(wav) };
        };
        const before = await render("noise-cam-off");
        const after = await render("noise-cam-on", with_({ noiseRemoval: true }));
        expect(rms(after.sound, 4, 5.5)).toBeLessThan(rms(before.sound, 4, 5.5) / 2);
        expect(shape(after.out.path)).toBe(shape(before.out.path));
        expect(after.out.durationMs).toBe(before.out.durationMs);
      });
    });

    describe("background blur", () => {
      const BLUR = with_({ background: "blur" });
      let cam: string;
      let leftMask: string;
      /** A mask video: white on the left half, or (`swapAt`) left until then and right after. 15 frames a second, like a device's. */
      async function makeMask(name: string, seconds: number, swapAt?: number) {
        const file = join(dir, name);
        const left = swapAt === undefined ? "lt(X,128)" : `if(lt(T,${swapAt}),lt(X,128),gte(X,128))`;
        await run(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=black:s=256x144:r=15:d=${seconds},format=gray,geq=lum='255*${left}'`,
          "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "200k", "-an", file]);
        return file;
      }
      /** How much fine detail a part of the picture has at `t` (mean edge strength, 0–255). */
      const detail = (file: string, part: "left" | "right" | "seam", t = 1.5) => {
        const crop = { left: "crop=iw/2-80:ih:0:0", right: "crop=iw/2-80:ih:iw/2+80:0", seam: "crop=6:ih:iw/2-3:0" }[part];
        return Number.parseFloat(
          execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
            "-vf", `${crop},sobel,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, "-f", "null", "-"])
            .toString().match(/YAVG=([\d.]+)/)![1]!,
        );
      };
      const camera = (over: Partial<TrackInput> = {}): TrackInput =>
        ({ trackId: "trk_v", participantId: "par_s", participantName: "Sam", kind: "video", rawPath: cam, offsetMs: 0, filters: BLUR, ...over });
      async function render(name: string, track: TrackInput, durationMs = 3000) {
        const failed: FilterFailure[] = [];
        const skipped: SkippedTrack[] = [];
        const outputs = await renderRecording([track], {
          ffmpeg, ffprobe, workDir: join(dir, name), durationMs, videoHeight: 720, font: null,
          onFilterFailed: (f) => failed.push(f), onSkipped: (s) => skipped.push(s),
        });
        return { video: outputs[0]!, combined: outputs.find((o) => o.kind === "combined")!, failed, skipped };
      }
      const SAM_VIDEO = [{ participantId: "par_s", name: "Sam", kind: "video" }];
      let asRecorded: Awaited<ReturnType<typeof render>>;

      // A camera with fine detail everywhere (a grainy test pattern), and a mask that says the person is on the left.
      beforeAll(async () => {
        cam = join(dir, "blur-cam.webm");
        await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=3,noise=alls=40:allf=t",
          "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "3M", "-an", cam]);
        leftMask = await makeMask("mask-left.webm", 3);
        asRecorded = await render("blur-none", camera({ filters: undefined }));
      });

      it("blurs the picture where the mask is black and leaves the person as recorded, with a soft edge", async () => {
        const blurred = await render("blur-on", camera({ mask: { rawPath: leftMask, offsetMs: 0 } }));
        expect(blurred.failed).toEqual([]);
        expect(blurred.skipped).toEqual([]);
        expect(detail(asRecorded.video.path, "left")).toBeGreaterThan(20);
        expect(detail(asRecorded.video.path, "right")).toBeGreaterThan(20);
        // The person's side keeps its detail; the other side loses nearly all of it.
        expect(detail(blurred.video.path, "left")).toBeGreaterThan(detail(asRecorded.video.path, "left") * 0.9);
        expect(detail(blurred.video.path, "right")).toBeLessThan(detail(asRecorded.video.path, "right") * 0.25);
        // From the very first frame: the picture never waits for the mask.
        expect(detail(blurred.video.path, "right", 0)).toBeLessThan(detail(asRecorded.video.path, "right", 0) * 0.25);
        // At the seam it is neither: the edge fades. Measured against the person's side of the same
        // file: with half the picture blurred the encoder has bits to spare, so the sharp side comes
        // out a little crisper than in the file as recorded.
        const kept = (part: "left" | "right" | "seam") => detail(blurred.video.path, part) / detail(asRecorded.video.path, part);
        expect(kept("seam")).toBeLessThan(kept("left") * 0.9);
        expect(kept("seam")).toBeGreaterThan(kept("right") * 1.5);
        // Same frame, frame rate, frame count and length as without it.
        expect(shape(blurred.video.path)).toBe(shape(asRecorded.video.path));
        expect(blurred.video.durationMs).toBe(asRecorded.video.durationMs);
        expect(blurred.video.fileName).toBe("Sam - video.mp4");
        // The side-by-side video shows the blurred picture.
        expect(detail(blurred.combined.path, "left")).toBeGreaterThan(20);
        expect(detail(blurred.combined.path, "right")).toBeLessThan(detail(asRecorded.combined.path, "right") * 0.25);
      });

      it("follows the mask in time, by the mask's own start, though it has half the frames", async () => {
        // The person moves from the left to the right 1.5 s into the mask, which began 500 ms after Record.
        const moving = await makeMask("mask-moving.webm", 2.5, 1.5);
        const out = await render("blur-moving", camera({ mask: { rawPath: moving, offsetMs: 500 } }));
        expect(out.failed).toEqual([]);
        const sharp = (part: "left" | "right", t: number) => detail(out.video.path, part, t) > detail(asRecorded.video.path, part, t) * 0.8;
        // Before the mask's first frame (under a second): nobody is known to be there, so all of it is blurred.
        expect([sharp("left", 0.2), sharp("right", 0.2)]).toEqual([false, false]);
        expect([sharp("left", 1.7), sharp("right", 1.7)]).toEqual([true, false]);
        expect([sharp("left", 2.3), sharp("right", 2.3)]).toEqual([false, true]); // the swap, at 2.0 s on the recording's clock
        expect(shape(out.video.path)).toBe(shape(asRecorded.video.path));
      });

      it("keeps the black before a late start black, and the picture's timing", async () => {
        const plainLate = await render("blur-late-off", camera({ filters: undefined, offsetMs: 1000 }));
        const late = await render("blur-late-on", camera({ offsetMs: 1000, mask: { rawPath: leftMask, offsetMs: 1000 } }));
        expect(late.failed).toEqual([]);
        expect(stat(late.video.path, "YAVG", 0.5)).toBe(stat(plainLate.video.path, "YAVG", 0.5));
        expect(stat(late.video.path, "YAVG", 0.5)).toBeLessThan(20);
        expect(detail(late.video.path, "left", 0.5)).toBeLessThan(1);
        // The first frame of the picture is where it is without the blur.
        const firstPicture = (file: string) => [0.9, 0.967, 1.0, 1.034, 1.1].find((t) => stat(file, "YAVG", t) > 30);
        expect(firstPicture(late.video.path)).toBe(firstPicture(plainLate.video.path));
        expect(detail(late.video.path, "left", 2)).toBeGreaterThan(20);
        expect(detail(late.video.path, "right", 2)).toBeLessThan(detail(plainLate.video.path, "right", 2) * 0.25);
        expect(shape(late.video.path)).toBe(shape(plainLate.video.path));
      });

      it("works together with a look and touch-up", async () => {
        const out = await render("blur-look", camera({ filters: with_({ background: "blur", look: "mono", brightness: 1, touchUp: true }), mask: { rawPath: leftMask, offsetMs: 0 } }));
        expect(out.failed).toEqual([]);
        expect(stat(out.video.path, "SATAVG")).toBeLessThan(1.5);
        expect(detail(out.video.path, "left")).toBeGreaterThan(15);
        expect(detail(out.video.path, "right")).toBeLessThan(detail(asRecorded.video.path, "right") * 0.25);
        expect(shape(out.video.path)).toBe(shape(asRecorded.video.path));
      });

      it("blurs each piece of someone who rejoined by its own mask, the gap still black", async () => {
        const pieces: TrackInput[] = [
          camera({ trackId: "trk_v1", endOffsetMs: 3000, mask: { rawPath: leftMask, offsetMs: 0 } }),
          camera({ trackId: "trk_v2", offsetMs: 4000, mask: { rawPath: leftMask, offsetMs: 4000 } }),
        ];
        const failed: FilterFailure[] = [];
        const [video] = await renderRecording(pieces, { ffmpeg, ffprobe, workDir: join(dir, "blur-pieces"), durationMs: 7000, videoHeight: 720, font: null, onFilterFailed: (f) => failed.push(f) });
        expect(failed).toEqual([]);
        for (const t of [1.5, 5.5]) {
          expect(detail(video!.path, "left", t), `left at ${t}`).toBeGreaterThan(20);
          expect(detail(video!.path, "right", t), `right at ${t}`).toBeLessThan(8);
        }
        expect(stat(video!.path, "YAVG", 3.5)).toBeLessThan(20);
        expect(Math.abs(video!.durationMs! - 7000)).toBeLessThan(80);
      });

      describe("a mask that can't be used costs the blur, never the file", () => {
        /** The file is there, as without the blur, and the host is told once. */
        async function expectUnblurred(name: string, track: TrackInput) {
          const out = await render(name, track);
          expect(out.skipped).toEqual([]);
          expect(out.failed).toEqual(SAM_VIDEO);
          expect(detail(out.video.path, "right")).toBeGreaterThan(detail(asRecorded.video.path, "right") * 0.9);
          expect(shape(out.video.path)).toBe(shape(asRecorded.video.path));
          expect(out.video.durationMs).toBe(asRecorded.video.durationMs);
          return out;
        }

        it("no mask at all", async () => {
          await expectUnblurred("blur-missing", camera());
        });

        it("a mask that isn't a video", async () => {
          const junk = join(dir, "mask-junk.raw");
          writeFileSync(junk, "this is not a mask");
          await expectUnblurred("blur-junk", camera({ mask: { rawPath: junk, offsetMs: 0 } }));
          // Cut off after its header: nothing to go by.
          const stub = join(dir, "mask-stub.raw");
          writeFileSync(stub, readFileSync(leftMask).subarray(0, 300));
          await expectUnblurred("blur-stub", camera({ mask: { rawPath: stub, offsetMs: 0 } }));
        });

        it("a mask that ends, starts or pauses more than a second short of the video", async () => {
          const short = await makeMask("mask-short.webm", 1.5);
          await expectUnblurred("blur-short", camera({ mask: { rawPath: short, offsetMs: 0 } }));
          await expectUnblurred("blur-mistimed", camera({ mask: { rawPath: leftMask, offsetMs: 1400 } }));
          // The device stopped making the mask for a while (frames from 0.6 s to 2.4 s are missing).
          const paused = join(dir, "mask-paused.webm");
          await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=black:s=256x144:r=15:d=3,drawbox=x=0:y=0:w=128:h=144:color=white:t=fill",
            "-vf", "select='lt(t,0.6)+gt(t,2.4)'", "-vsync", "vfr", "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "200k", "-an", paused]);
          await expectUnblurred("blur-paused", camera({ mask: { rawPath: paused, offsetMs: 0 } }));
        });

        it("but a mask short by under a second is used: that stretch is blurred whole", async () => {
          const nearly = await makeMask("mask-nearly.webm", 2.4);
          const out = await render("blur-nearly", camera({ mask: { rawPath: nearly, offsetMs: 0 } }));
          expect(out.failed).toEqual([]);
          expect(detail(out.video.path, "left", 1.5)).toBeGreaterThan(20);
          expect(detail(out.video.path, "left", 2.8)).toBeLessThan(8);
          expect(detail(out.video.path, "right", 2.8)).toBeLessThan(8);
          // What the video's own length is comes from its chunks when the recording went on without it.
          const ended = await render("blur-ended", camera({ endOffsetMs: 3000, mask: { rawPath: leftMask, offsetMs: 0 } }), 6000);
          expect(ended.failed).toEqual([]);
        });

        it("an ffmpeg that can't run the blur: the person's look stays, the blur goes", async () => {
          const bin = join(dir, "no-alphamerge.sh");
          writeFileSync(bin, `#!/bin/sh\ncase "$*" in *alphamerge*) echo "No such filter: 'alphamerge'" >&2; exit 1;; esac\nexec "${ffmpeg}" "$@"\n`);
          chmodSync(bin, 0o755);
          const failed: FilterFailure[] = [];
          const [video] = await renderRecording(
            [camera({ filters: with_({ background: "blur", look: "mono" }), mask: { rawPath: leftMask, offsetMs: 0 } })],
            { ffmpeg: bin, ffprobe, workDir: join(dir, "blur-old-ffmpeg"), durationMs: 3000, videoHeight: 720, font: null, onFilterFailed: (f) => failed.push(f) },
          );
          expect(failed).toEqual(SAM_VIDEO);
          expect(stat(video!.path, "SATAVG")).toBeLessThan(1.5);
          expect(detail(video!.path, "right")).toBeGreaterThan(20);
        });
      });
    });

    describe("the commands themselves", () => {
      /** An ffmpeg that writes down the filters it was asked for, then runs the real one (or fails on `failOn`). */
      function spy(name: string, failOn = "") {
        const log = join(dir, `${name}.log`);
        const path = join(dir, `${name}.sh`);
        writeFileSync(
          path,
          `#!/bin/sh\nprev=""\nfor a in "$@"; do\n  case "$prev" in -vf|-af|-filter_complex) echo "$prev $a" >> "${log}";; esac\n  prev="$a"\ndone\n` +
            (failOn ? `case "$*" in *${failOn}*) echo "No such filter" >&2; exit 1;; esac\n` : "") +
            `exec "${ffmpeg}" "$@"\n`,
        );
        chmodSync(path, 0o755);
        return { path, lines: () => readFileSync(log, "utf8").trim().split("\n") };
      }
      const tracks = (filters?: TrackFilters): TrackInput[] => [
        { trackId: "trk_a", participantId: "par_s", participantName: "Sam", kind: "audio", rawPath: audioWebm, offsetMs: 500, filters },
        { trackId: "trk_v", participantId: "par_s", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 500, filters },
      ];
      const options = (name: string, bin: string) => ({ ffmpeg: bin, ffprobe, workDir: join(dir, "same"), durationMs: 3000, videoHeight: 720 as const, font: null });

      it("are exactly today's when there are no filters (the sync measurements were made with them)", async () => {
        const none = spy("spy-none");
        const off = spy("spy-off");
        await renderRecording(tracks(), options("spy-none", none.path));
        await renderRecording(tracks(NO_FILTERS), options("spy-off", off.path));
        expect(off.lines()).toEqual(none.lines());
        // A mask with nobody asking for the blur is never read, and neither is a look's with it.
        const masked = spy("spy-masked");
        await renderRecording(tracks(NO_FILTERS).map((t) => ({ ...t, mask: { rawPath: videoWebm, offsetMs: 500 } })), options("spy-masked", masked.path));
        expect(masked.lines()).toEqual(none.lines());
        expect(none.lines().slice(0, 3)).toEqual([
          "-af aresample=48000,asetpts=N/SR/TB,adelay=500:all=1,apad",
          "-vf fps=30,tpad=start_duration=0.500:start_mode=add:color=black,tpad=stop=-1:stop_mode=clone,scale=-2:720,format=yuv420p",
          "-af aresample=48000,asetpts=N/SR/TB,adelay=500:all=1,apad",
        ]);
        expect(none.lines().join("\n")).not.toMatch(/eq=|colortemperature|bilateral|afftdn/);
      });

      it("put the look before alignment and noise removal after it", async () => {
        const on = spy("spy-on");
        await renderRecording(tracks({ ...NO_FILTERS, brightness: 1, look: "cool", touchUp: true, noiseRemoval: true }), options("spy-on", on.path));
        const lines = on.lines().filter((l) => !l.includes("asplit")); // the one-off measurement of the filter's delay
        const clean = /(apad=pad_len=\d+,)?afftdn=nr=12:nf=-\d+(,atrim=start_sample=\d+,asetpts=N\/SR\/TB)?/.source;
        expect(lines[0]).toBe("-af aresample=48000,asetpts=N/SR/TB,adelay=500:all=1,apad"); // the WAV as recorded first...
        expect(lines[1]).toMatch(new RegExp(`^-af ${clean},apad$`)); // ...then cleaned from it
        expect(lines[3]).toMatch(new RegExp(`^-af aresample=48000,asetpts=N/SR/TB,adelay=500:all=1,apad,${clean}$`));
        expect(lines.slice(2, 3)).toEqual([
          "-vf eq=brightness=0.04:contrast=1.03:gamma=1.15:saturation=1.02,colortemperature=temperature=8200,bilateral=sigmaS=3:sigmaR=0.05:planes=1," +
            "fps=30,tpad=start_duration=0.500:start_mode=add:color=black,tpad=stop=-1:stop_mode=clone,scale=-2:720,format=yuv420p",
        ]);
      });

      it("never lose a file to a filter this ffmpeg can't run: it is rendered as recorded, and says so", async () => {
        const old = spy("spy-old", "bilateral");
        const skipped: SkippedTrack[] = [];
        const failed: FilterFailure[] = [];
        const outputs = await renderRecording(tracks(with_({ touchUp: true })), {
          ...options("spy-old", old.path), onSkipped: (s) => skipped.push(s), onFilterFailed: (f) => failed.push(f),
        });
        expect(outputs.map((o) => o.fileName)).toEqual(["Sam - audio.wav", "Sam - video.mp4", "Combined.mp4"]);
        expect(skipped).toEqual([]);
        // The video only: touch-up has nothing to do with their sound.
        expect(failed).toEqual([{ participantId: "par_s", name: "Sam", kind: "video" }]);

        const deaf = spy("spy-deaf", "afftdn");
        failed.length = 0;
        const sound = await renderRecording([tracks(with_({ noiseRemoval: true }))[0]!], { ...options("spy-deaf", deaf.path), onFilterFailed: (f) => failed.push(f) });
        expect(sound.map((o) => o.fileName)).toEqual(["Sam - audio.wav", "Combined.wav"]);
        expect(samples(sound[0]!.path).length).toBe(144_000);
        expect(failed).toEqual([{ participantId: "par_s", name: "Sam", kind: "audio" }]);
      });

      it("says it once per file when a rejoined person's pieces all fall back, and not at all when filters work or a track is unreadable", async () => {
        const pieces = (filters?: TrackFilters): TrackInput[] => [
          { trackId: "trk_v1", participantId: "par_s", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 0, filters },
          { trackId: "trk_v2", participantId: "par_s", participantName: "Sam", kind: "video", rawPath: videoWebm, offsetMs: 3000, filters },
        ];
        const failed: FilterFailure[] = [];
        const old = spy("spy-old-pieces", "bilateral");
        await renderRecording(pieces(with_({ touchUp: true })), { ...options("", old.path), workDir: join(dir, "fail-pieces"), durationMs: 6000, onFilterFailed: (f) => failed.push(f) });
        expect(failed).toEqual([{ participantId: "par_s", name: "Sam", kind: "video" }]);

        failed.length = 0;
        const skipped: SkippedTrack[] = [];
        const junk = join(dir, "filter-junk.raw");
        writeFileSync(junk, "this is not media");
        await renderRecording(
          [...tracks(with_({ touchUp: true, noiseRemoval: true })), { trackId: "trk_bad", participantId: "par_b", participantName: "Bo", kind: "video", rawPath: junk, offsetMs: 0, filters: with_({ touchUp: true }) }],
          { ffmpeg, ffprobe, workDir: join(dir, "fail-none"), durationMs: 3000, videoHeight: 720, font: null, onFilterFailed: (f) => failed.push(f), onSkipped: (s) => skipped.push(s) },
        );
        expect(failed).toEqual([]);
        expect(skipped.map((s) => s.trackId)).toEqual(["trk_bad"]);
      });
    });
  });
});
