# 03 — Recording Architecture (the hard part)

Two independent paths run at the same time:

```
                ┌───────────── live call (LiveKit SFU) ─────────────┐
 guest browser  │  low-res video + audio, for conversation only     │  other guests
                └───────────────────────────────────────────────────┘
       │
       ├── local recording path:
       │   camera+mic MediaStream ─► MediaRecorder (high bitrate, timeslice 2–5s)
       │        ─► chunk written to OPFS/IndexedDB (crash safety)
       │        ─► upload queue ─► presigned S3 multipart part ─► storage (ours or customer's)
       │        ─► server ack ─► delete local chunk
       │
       └── telemetry path (metadata only, no media):
           levels, clipping, echo estimate, disk free, upload lag, tab visibility
               ─► LiveKit data channel / API ─► host's per-guest status + alerts
```

The call quality can degrade; the **local recording never does** (captured before the network).

## 1. Capture
- `getUserMedia` with explicit constraints: up to 1080p (4K later), 30 fps, 48 kHz audio; echo cancellation configurable (off for headphone users).
- Separate audio recorder (AudioWorklet → PCM/WAV or Opus) for the best audio; video recorder separately.
- Codec selection via `MediaRecorder.isTypeSupported()`: Chromium WebM (VP9/VP8 + Opus) or MP4; Safari MP4 (H.264 + AAC).
- Fixed bitrates (video 6–10 Mbps @1080p; audio PCM or 128–256 kbps Opus).
- Later: **WebCodecs** encoder + muxer for constant frame rate and finer control.

## 2. Local durability
- Each chunk (timeslice 2–5 s) is written first to **OPFS** (fallback IndexedDB).
- Chunks are deleted **only after the server confirms** the part.
- On reload/crash/rejoin: scan OPFS → resume uploading leftovers for that session automatically.
- Green room checks `navigator.storage.estimate()`; warn if < ~2 GB free; alert during recording if it drops.
- Request persistent storage (`navigator.storage.persist()`) where supported.

## 3. Upload
- Server issues **presigned multipart upload URLs** for the workspace's bucket (our R2/MinIO, or **customer's own S3-compatible bucket**).
- 2–3 parallel uploads, retry with exponential backoff, idempotent parts (seq number + checksum).
- If upload falls behind: keep buffering locally; host sees "Guest 2: 3 min behind".
- `CompleteMultipartUpload` on stop after all parts confirmed; `beforeunload` warning until 100%.

## 4. Live status and quality alerts (new in v2 plan)
Computed on each guest's device, sent as small metadata messages every 1–2 s:

| Signal | How | Alert threshold (tune in alpha) |
|---|---|---|
| Upload progress | confirmed bytes / recorded bytes | Show always; warn if > 60 s behind |
| Mic clipping | peak ≥ −1 dBFS repeatedly | > 3 clips in 10 s |
| Too quiet | RMS level | below −45 dBFS for 10 s while speaking expected |
| Echo | correlation between remote audio played and local mic | sustained high correlation → "use headphones" |
| Disk space | `storage.estimate()` | < 1 GB left |
| Tab hidden / device sleep risk | `visibilitychange`, Battery API where available | immediate warning (mobile especially) |
| Recorder errors | MediaRecorder `onerror`, track `ended` | immediate, with auto-restart of recorder |

**No media and no transcript text in telemetry.**

## 5. Sync
- **Clock offset:** NTP-style pings → offset per participant; every chunk stores start time in server time.
- **Start marker:** host's Record command carries a server timestamp; each recorder logs its actual start.
- **Alignment:** timestamps first, then audio cross-correlation refinement → target < 20 ms.
- **Constant frame rate** normalisation (ffmpeg) to remove MediaRecorder drift.

## 6. Post-processing (worker)
1. Concatenate chunks → per-participant raw files.
2. Normalise: CFR video (H.264/MP4), audio WAV/FLAC, loudness (EBU R128).
3. Align tracks (offsets from §5).
4. Render combined video (grid / active-speaker layout).
5. **Transcribe on our/customer's server** (faster-whisper GPU in cloud; whisper.cpp CPU for self-host). Speaker = track, so labels are always correct.
6. Optional (v1.1): redaction pass, local-model summary/chapters.
7. Build exports: zip, editor project files (v1.2), research exports (v1.2).
8. Notify host; update processing timeline.

## 7. Browser constraints & mitigations

| Problem | Mitigation |
|---|---|
| Safari MediaRecorder differences | Feature detection, MP4 path, dedicated tests; if Gate A fails on Safari → launch "Chrome-first, Safari beta" |
| Mobile: recording stops when backgrounded / screen locks | Warn guests, Wake Lock API, alert host, recommend desktop |
| Long recordings → memory/disk | Small timeslices, write to OPFS immediately, never hold chunks in RAM |
| Echo / feedback | Headphone prompt, echo alert, echo-cancellation toggle |
| Firewalls blocking WebRTC | TURN (LiveKit); uploads use plain HTTPS |
| Slow uplink | Recording continues locally; upload catches up after |
| Tab closed early | Leftover chunks resume on next visit to the studio link |

## 8. Test matrix (before launch)
Chrome/Edge/Firefox/Safari × macOS/Windows/Linux/iPad; 2–4 participants; 15 / 60 / 120 min; throttled network (1 Mbps up, 5% packet loss); tab crash mid-recording; laptop sleep; disk nearly full; customer-bucket upload (BYO storage).

**Release rule:** zero lost recordings across the matrix. Publish the matrix and results in `docs/browser-support.md` — reliability is marketing.
