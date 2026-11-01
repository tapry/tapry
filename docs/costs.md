# What a recorded hour costs

Measured 1 Nov 2026 with `apps/worker/scripts/cost-benchmark.sh` on an Apple M4 Pro (12 cores),
OpenTake 0.1.1, 1080p studio setting, even volume on, transcripts with whisper.cpp `base`.

## Method

The script builds a 3-minute, 2-person episode the way browsers record it (per person: a 1080p
VP9 camera track at the recorder's 8 Mbit/s with sound, and an Opus audio track at 128 kbit/s),
with real speech and webcam-like noise in the picture, then runs the real processing pipeline and
transcription and times their CPU with `/usr/bin/time`. Everything scales linearly with length, so
the numbers below are per recorded hour. Two runs bracket real cameras: heavy sensor noise
(`NOISE=10`, a dim room or cheap webcam) and a clean picture (`NOISE=3`).

## Results, per recorded hour with 2 people

| | Clean picture | Noisy picture |
|---|---|---|
| Original uploads (raw chunks) | 6.2 GB | 8.2 GB |
| Processed: each person's WAV | 0.35 GB each | 0.35 GB each |
| Processed: each person's MP4 | 3.6 GB each | 4.7 GB each |
| Processed: side-by-side video | 0.7 GB | 0.8 GB |
| **Stored, originals kept** | **14.9 GB** | **19.2 GB** |
| **Stored, originals removed** | **8.7 GB** | **11.0 GB** |
| Processing (render, level, align) | 112 CPU-min (14 min wall) | 149 CPU-min (17 min wall) |
| Transcription (whisper.cpp base) | 2 CPU-min | 2 CPU-min |

Per person and hour: about 3–4 GB uploaded, 4–5 GB of processed files, and 55–75 CPU-minutes of
processing. 720p roughly halves the video sizes and the encoding time.

## What it tells us

1. **The processed video is the biggest cost, not the upload.** Each person's MP4 (H.264, CRF 20)
   comes out *larger* than the 8 Mbit/s VP9 they recorded: the re-encode spends more bits than
   the original had, without adding quality. Capping the re-encode at the original's bitrate
   would cut storage by about a third. (Follow-up; not changed yet.)
2. **Removing originals after processing saves 40%.** `RAW_RETENTION_DAYS` (off by default) does
   it; see [self-hosting.md](self-hosting.md). Trade-off: the originals are the best-quality
   copies, and an episode can't be processed again after they go.
3. **Processing is CPU-heavy; transcription is not.** Rendering is mostly x264 encoding of
   1080p video: about 1 vCPU-hour per person per recorded hour. Whisper `base` adds almost
   nothing.
4. **Storage dominates the cloud bill.** Example with plan v2's figures (R2 at $0.015 per GB-month;
   check current prices) and an assumed $0.01 per vCPU-hour:

   | Creator plan at full use: 20 h/month, 2 people | Storage held at steady state | Storage $/month | Processing $/month |
   |---|---|---|---|
   | Everything kept 90 days | 900–1,150 GB | $13–17 | ~$0.40–0.50 |
   | Originals removed after 7 days, files kept 90 days | ~550–700 GB | $8–10 | same |
   | Originals removed after 7 days, files kept 30 days | ~200–250 GB | $3–4 | same |

   At $9/month, Creator only pays at full use with shorter retention, smaller video files, or
   both. Average use (plan v2 expects 30–40%) leaves room either way. Bring-your-own-storage moves
   the storage line to the customer, leaving processing, which is cheap per hour but should still
   have a fair-use limit.

## Re-run it

```bash
FFMPEG_PATH=… FFPROBE_PATH=… WHISPER_PATH=… WHISPER_MODEL=… apps/worker/scripts/cost-benchmark.sh 180 2
NOISE=3 apps/worker/scripts/cost-benchmark.sh 180 2   # a clean picture
```
