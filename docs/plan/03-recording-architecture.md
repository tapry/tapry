# 03 — Recording Architecture (the hard part)

Two independent paths run at the same time:

```
                ┌───────────── live call (LiveKit SFU) ─────────────┐
 guest browser  │  low-res video + audio, for conversation only     │  other guests
                └───────────────────────────────────────────────────┘
       │
       └── local recording path:
           camera+mic MediaStream ─► MediaRecorder (high bitrate, timeslice 2–5s)
                ─► chunk written to OPFS/IndexedDB (crash safety)
                ─► upload queue ─► presigned S3 multipart part ─► storage
                ─► ack ─► delete local chunk
```

The call quality can degrade; the **local recording never does** (it's captured before the network).

## 1. Capture
- `getUserMedia` with explicit constraints: up to 1080p (4K later), 30 fps, 48 kHz audio; echo cancellation configurable (off for headphone users → better audio).
- Separate audio-only recorder (Opus/WAV via AudioWorklet → PCM) for the best audio track; video recorder separately.
- Codec selection via `MediaRecorder.isTypeSupported()`:
  - Chromium: WebM (VP9/VP8 + Opus) or MP4 where supported.
  - Safari: MP4 (H.264 + AAC).
- Record at fixed bitrate (e.g., video 6–10 Mbps @1080p, audio 128–256 kbps Opus or PCM).
- v2 option: **WebCodecs** encoder + muxer for precise control and constant frame rate.

## 2. Local durability
- Each chunk (from `ondataavailable`, timeslice 2–5 s) is written first to **OPFS** (Origin Private File System) or IndexedDB.
- Chunks are deleted only after the server confirms upload.
- On reload/crash: app scans OPFS → resumes uploading leftovers for that session.
- Check storage quota in the green room (`navigator.storage.estimate()`), warn if < ~2 GB free.

## 3. Upload
- Server issues **presigned multipart upload URLs** (S3-compatible: R2 / MinIO).
- Parallel uploads (2–3 at a time) with retry + exponential backoff.
- Bandwidth-aware: if upload falls behind, keep buffering locally; show "X min behind".
- Integrity: each part's checksum/ETag recorded; final `CompleteMultipartUpload` on stop.
- Upload continues after Stop until 100%; block tab close with `beforeunload` warning.

## 4. Sync
- **Clock offset:** client pings server N times (NTP-like) → estimates offset; every chunk stores start time in server time.
- **Start marker:** host's Record command carries a server timestamp; each recorder logs its actual start.
- **Post alignment:** align tracks by timestamps, then refine with audio cross-correlation (short window) to get < 20 ms accuracy.
- **Normalize video** to constant frame rate (ffmpeg) to fix MediaRecorder's variable frame rate and drift.

## 5. Post-processing (worker)
1. Concatenate chunks → per-participant raw files.
2. Transcode/normalize: CFR video (H.264/MP4), audio to WAV/FLAC; loudness normalization (EBU R128).
3. Align tracks (offsets from step 4).
4. Render combined video (ffmpeg `filter_complex` grid/speaker layout).
5. Transcribe (Whisper — faster-whisper on GPU for cloud; CPU or API option for self-host); diarization by track (each track = one speaker → easy).
6. Package outputs; notify host.

## 6. Browser constraints & mitigations

| Problem | Mitigation |
|---|---|
| Safari MediaRecorder differences | Feature detection, MP4 path, test matrix |
| Mobile: recording stops when tab backgrounded / screen locks | Warn guests; wake lock API; recommend desktop for guests |
| Long recordings → memory/disk | Small timeslices, write to OPFS immediately, never keep chunks in RAM |
| Echo / feedback | Headphone prompt; echo cancellation toggle |
| Firewalls blocking WebRTC | TURN server (LiveKit includes TURN); upload uses plain HTTPS |
| Slow uplink | Recording continues locally; upload catches up after |
| Tab closed early | Leftover chunks resume on next visit to the studio link |

## 7. Test matrix (before launch)
Chrome/Edge/Firefox/Safari × macOS/Windows/Linux/iPad; 2–4 participants; 15 / 60 / 120 min sessions; throttled network (1 Mbps up, packet loss 5%); tab crash mid-recording; laptop sleep; disk nearly full.

**Release rule:** zero lost recordings across the matrix.
