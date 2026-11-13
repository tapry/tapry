// Cost benchmark, not a regular test: runs only from scripts/cost-benchmark.sh (COST_BENCH_DIR set).
// Phase "render" processes the synthetic episode with the real pipeline; phase "transcribe"
// transcribes the WAVs it produced. The script times each phase's CPU with /usr/bin/time.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { PODCAST_LOUDNESS, renderRecording, type TrackInput } from "../src/pipeline.js";
import { transcribeAudio } from "../src/transcribe.js";

const dir = process.env.COST_BENCH_DIR;
const phase = process.env.COST_BENCH_PHASE;
const people = Number(process.env.COST_BENCH_PEOPLE ?? 2);
const seconds = Number(process.env.COST_BENCH_SECONDS ?? 180);

describe.skipIf(!dir)("cost benchmark", () => {
  it(`phase ${phase}`, { timeout: 3_600_000 }, async () => {
    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
    const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
    const started = Date.now();
    if (phase === "render") {
      const tracks: TrackInput[] = [];
      for (let i = 0; i < people; i++) {
        const name = `Person ${i + 1}`;
        tracks.push({ trackId: `a${i}`, participantId: `p${i}`, participantName: name, kind: "audio", rawPath: join(dir!, `p${i}-audio.webm`), offsetMs: 0 });
        tracks.push({ trackId: `v${i}`, participantId: `p${i}`, participantName: name, kind: "video", rawPath: join(dir!, `p${i}-video.webm`), offsetMs: 0 });
      }
      const outputs = await renderRecording(tracks, {
        ffmpeg,
        ffprobe,
        workDir: join(dir!, "out"),
        durationMs: seconds * 1000,
        videoQuality: "1080p",
        loudness: PODCAST_LOUDNESS,
      });
      const report = outputs.map((o) => ({ file: o.fileName, kind: o.kind, bytes: statSync(o.path).size }));
      writeFileSync(join(dir!, "render.json"), JSON.stringify({ wallMs: Date.now() - started, outputs: report }, null, 2));
    } else if (phase === "transcribe") {
      const wavs = readdirSync(join(dir!, "out")).filter((f) => f.endsWith(".wav") && !f.includes("mix"));
      for (const f of wavs) {
        await transcribeAudio(join(dir!, "out", f), {
          whisper: process.env.WHISPER_PATH!,
          model: process.env.WHISPER_MODEL!,
          vadModel: process.env.WHISPER_VAD_MODEL || undefined,
          ffmpeg,
          threads: Number(process.env.WHISPER_THREADS ?? 4),
        });
      }
      writeFileSync(join(dir!, "transcribe.json"), JSON.stringify({ wallMs: Date.now() - started, files: wavs.length }, null, 2));
    }
  });
});
