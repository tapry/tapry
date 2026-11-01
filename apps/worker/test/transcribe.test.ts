// Transcripts. The whisper tests need WHISPER_PATH + WHISPER_MODEL (+ optional WHISPER_VAD_MODEL)
// and macOS's `say` for real speech; they're skipped otherwise.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mergeSpeakers, toSrt, toTxt, toVtt, transcribeAudio, type SpeakerTranscript } from "../src/transcribe.js";

describe("transcript formats", () => {
  const speakers: SpeakerTranscript[] = [
    {
      speaker: "Sam",
      language: "en",
      segments: [
        { startMs: 4_200, endMs: 6_000, text: "Thanks for having me." },
        { startMs: 6_500, endMs: 8_000, text: "It's great to be here." },
      ],
    },
    { speaker: "Host <&>", language: "en", segments: [{ startMs: 0, endMs: 4_000, text: "Welcome to the show, Sam." }] },
  ];
  const lines = mergeSpeakers(speakers);

  it("merges everyone onto one timeline", () => {
    expect(lines.map((l) => [l.speaker, l.startMs])).toEqual([
      ["Host <&>", 0],
      ["Sam", 4_200],
      ["Sam", 6_500],
    ]);
  });

  it("writes SRT with speaker names", () => {
    expect(toSrt(lines)).toBe(
      "1\n00:00:00,000 --> 00:00:04,000\nHost <&>: Welcome to the show, Sam.\n\n" +
        "2\n00:00:04,200 --> 00:00:06,000\nSam: Thanks for having me.\n\n" +
        "3\n00:00:06,500 --> 00:00:08,000\nSam: It's great to be here.\n",
    );
  });

  it("writes WebVTT with escaped voice tags", () => {
    const vtt = toVtt(lines);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:04.000\n<v Host &lt;&amp;&gt;>Welcome to the show, Sam.");
    expect(vtt).toContain("<v Sam>Thanks for having me.");
  });

  it("writes a readable text transcript with one paragraph per turn", () => {
    expect(toTxt(lines)).toBe(
      "[00:00:00] Host <&>: Welcome to the show, Sam.\n\n[00:00:04] Sam: Thanks for having me. It's great to be here.\n",
    );
  });

  it("formats hours", () => {
    expect(toSrt([{ speaker: "A", startMs: 3_723_456, endMs: 3_724_000, text: "late" }])).toContain("01:02:03,456 --> 01:02:04,000");
  });
});

const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const whisper = process.env.WHISPER_PATH;
const model = process.env.WHISPER_MODEL;
const vadModel = process.env.WHISPER_VAD_MODEL;
const canRun = (() => {
  try {
    execFileSync("say", ["-v", "?"], { stdio: "ignore" });
    execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
    return !!(whisper && model);
  } catch {
    return false;
  }
})();

describe.skipIf(!canRun)("whisper.cpp on real speech", () => {
  let dir: string;
  const opts = () => ({ whisper: whisper!, model: model!, vadModel, ffmpeg, threads: 4, timeoutMs: 120_000 });

  /** Spoken text as a 48 kHz WAV (what the pipeline produces), optionally starting after `delayMs`. */
  function speech(name: string, voice: string, text: string, delayMs = 0, totalS = 0) {
    const aiff = join(dir, `${name}.aiff`);
    const wav = join(dir, `${name}.wav`);
    execFileSync("say", ["-v", voice, "-o", aiff, text]);
    const filters = [delayMs ? `adelay=${delayMs}:all=1` : "", totalS ? `apad=whole_dur=${totalS}` : ""].filter(Boolean);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", aiff, ...(filters.length ? ["-af", filters.join(",")] : []),
      "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    return wav;
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tapry-whisper-test-"));
  });

  it("transcribes English", async () => {
    const wav = speech("en", "Samantha", "Welcome to the show. Today we are talking about recording podcasts remotely.");
    const { language, segments } = await transcribeAudio(wav, opts());
    const text = segments.map((s) => s.text).join(" ").toLowerCase();
    expect(language).toBe("en");
    expect(text).toContain("welcome to the show");
    expect(text).toMatch(/podcasts? remotely/);
  });

  it("detects and transcribes French", async () => {
    const wav = speech("fr", "Thomas", "Bonjour à tous, et bienvenue dans notre émission.");
    const { language, segments } = await transcribeAudio(wav, opts());
    const text = segments.map((s) => s.text).join(" ").toLowerCase();
    expect(language).toBe("fr");
    expect(text).toContain("bonjour");
    expect(text).toContain("bienvenue");
  });

  it("returns nothing for a silent track instead of inventing text", async () => {
    const wav = join(dir, "silence.wav");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "20",
      "-c:a", "pcm_s16le", wav]);
    const { segments } = await transcribeAudio(wav, opts());
    expect(segments).toEqual([]);
  });

  it("keeps each speaker's timing on the recording timeline", async () => {
    // Two people's aligned tracks: the guest answers 6 s in; silence elsewhere on each track.
    const host = speech("host", "Daniel", "So tell us about your new book.", 0, 12);
    const guest = speech("guest", "Samantha", "It is about learning to cook at home.", 6_000, 12);
    const lines = mergeSpeakers([
      { speaker: "Host", ...(await transcribeAudio(host, opts())) },
      { speaker: "Guest", ...(await transcribeAudio(guest, opts())) },
    ]);
    expect(lines.map((l) => l.speaker)).toEqual(["Host", "Guest"]);
    expect(lines[0]!.startMs).toBeLessThan(1_000);
    expect(lines[1]!.startMs).toBeGreaterThan(5_000);
    expect(lines[1]!.startMs).toBeLessThan(7_500);
    expect(lines[1]!.text.toLowerCase()).toContain("cook");
  });
});
