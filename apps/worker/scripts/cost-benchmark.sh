#!/usr/bin/env bash
# What one recorded hour costs to store and process, measured on this machine.
#
#   FFMPEG_PATH=… FFPROBE_PATH=… WHISPER_PATH=… WHISPER_MODEL=… apps/worker/scripts/cost-benchmark.sh [seconds] [people]
#
# Builds a synthetic episode the way the browser records one (per person: a 1080p VP9 camera
# track at 8 Mbit/s with sound, and an Opus audio track at 128 kbit/s), with webcam-like noise in
# the picture and real speech (macOS `say`, else a tone) so the encoders and Whisper do real
# work. Then runs the real processing pipeline and transcription, timing CPU with /usr/bin/time.
# NOISE (default 10) sets the sensor noise; 3 is a clean, well-lit webcam. Results scale
# linearly with length; see docs/costs.md.
set -euo pipefail

SECONDS_LEN=${1:-180}
PEOPLE=${2:-2}
FFMPEG=${FFMPEG_PATH:-ffmpeg}
HERE=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d "${TMPDIR:-/tmp}/tapry-cost-XXXXXX")
trap 'rm -rf "$DIR"' EXIT

echo "Synthetic episode: $PEOPLE people × $SECONDS_LEN s in $DIR"
if command -v say >/dev/null; then
  say -v Samantha -o "$DIR/speech.aiff" "Welcome back to the show. Today we are talking about how small teams record remote interviews \
    without losing a single minute, even when someone's internet drops halfway through. It starts with recording on each \
    person's own computer, in full quality, and sending the pieces while the conversation is still going."
  SPEECH=(-stream_loop -1 -i "$DIR/speech.aiff")
else
  SPEECH=(-f lavfi -i "sine=frequency=220:sample_rate=48000")
fi

for ((i = 0; i < PEOPLE; i++)); do
  # Camera: moving test pattern plus temporal noise, like a real webcam sensor.
  "$FFMPEG" -y -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=1920x1080:rate=30,noise=alls=${NOISE:-10}:allf=t+u" "${SPEECH[@]}" -t "$SECONDS_LEN" \
    -map 0:v -map 1:a -c:v libvpx-vp9 -b:v 8M -deadline realtime -cpu-used 8 -row-mt 1 \
    -c:a libopus -b:a 128k -ar 48000 "$DIR/p$i-video.webm"
  "$FFMPEG" -y -hide_banner -loglevel error "${SPEECH[@]}" -t "$SECONDS_LEN" -c:a libopus -b:a 128k -ar 48000 "$DIR/p$i-audio.webm"
done

raw=$(du -k "$DIR"/p*-*.webm | awk '{s += $1} END {print s * 1024}')
echo "Raw upload: $raw bytes"

cd "$HERE"
for phase in render transcribe; do
  if [[ $phase == transcribe && -z "${WHISPER_MODEL:-}" ]]; then continue; fi
  # /usr/bin/time reports the CPU of the whole process tree (ffmpeg, whisper-cli included).
  /usr/bin/time -p env COST_BENCH_DIR="$DIR" COST_BENCH_PHASE=$phase COST_BENCH_PEOPLE=$PEOPLE COST_BENCH_SECONDS=$SECONDS_LEN \
    pnpm -s exec vitest run test/cost-bench.test.ts >/dev/null 2>"$DIR/$phase.time" || { cat "$DIR/$phase.time"; exit 1; }
  echo "$phase: $(grep -E '^(real|user|sys)' "$DIR/$phase.time" | tr '\n' ' ')"
done

node -e '
const fs = require("fs"), dir = process.argv[1], secs = +process.argv[2], people = +process.argv[3], raw = +process.argv[4];
const r = JSON.parse(fs.readFileSync(dir + "/render.json"));
const perHour = (b) => b * 3600 / secs;
const gb = (b) => (b / 1e9).toFixed(2) + " GB";
const t = (p) => { try { const s = fs.readFileSync(`${dir}/${p}.time`, "utf8"); const g = (k) => +(s.match(new RegExp("^" + k + " ([\\d.]+)", "m")) || [0, 0])[1]; return { wall: g("real"), cpu: g("user") + g("sys") }; } catch { return null; } };
const render = t("render"), tx = t("transcribe");
const byKind = {};
for (const o of r.outputs) byKind[o.kind] = (byKind[o.kind] || 0) + o.bytes;
const outputs = r.outputs.reduce((n, o) => n + o.bytes, 0);
console.log("\nPer recorded hour (" + people + " people):");
console.log("  raw upload       " + gb(perHour(raw)) + "  (" + gb(perHour(raw) / people) + " per person)");
for (const [k, b] of Object.entries(byKind)) console.log("  outputs " + k.padEnd(9) + gb(perHour(b)));
console.log("  outputs total    " + gb(perHour(outputs)));
console.log("  stored, raw kept " + gb(perHour(raw + outputs)) + "   stored, raw deleted " + gb(perHour(outputs)));
if (render) console.log("  processing       " + (perHour(render.cpu) / 60).toFixed(1) + " CPU-min, " + (perHour(render.wall) / 60).toFixed(1) + " min wall");
if (tx) console.log("  transcription    " + (perHour(tx.cpu) / 60).toFixed(1) + " CPU-min, " + (perHour(tx.wall) / 60).toFixed(1) + " min wall");
' "$DIR" "$SECONDS_LEN" "$PEOPLE" "$raw"
