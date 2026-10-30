# 0001 — Upload each chunk as its own object, not as S3 multipart parts

Status: accepted (30 Oct 2026). Supersedes "presigned S3 multipart" in `docs/plan/03-recording-architecture.md` §3.

## Problem
The plan maps each MediaRecorder chunk (2–5 s) to one S3 multipart part. That breaks on real storage:

- **S3/MinIO:** every part except the last must be ≥ 5 MiB. A 4 s audio-only Opus chunk is ~64–128 KB; even a 1080p video chunk at 6 Mbps is ~3 MB.
- **Cloudflare R2:** every part except the last must be the **same size**. MediaRecorder chunks never are.

Buffering chunks into 5 MiB parts would fix S3 but not R2, and makes crash recovery harder (a part spans several local chunks, so part boundaries must be rebuilt identically after a crash).

## Decision
Each chunk is uploaded with a presigned `PUT` to its own key:

```
recordings/{sessionId}/{trackId}/{seq:08}.chunk
```

The client then calls a `commit` endpoint (bytes, start/end time, SHA-256) so the server records it in the `chunks` table. The local copy is deleted only after `commit` succeeds. When the recorder stops, the client calls `complete` with the last sequence number. The worker checks that every seq `0..lastSeq` is present, then concatenates in order.

## Consequences
- Re-uploading a chunk is naturally idempotent (same key, same bytes).
- Works the same on S3, MinIO and R2.
- More PUT requests: 1 h at 4 s chunks = 900 PUTs per track ≈ $0.004 on R2 Class A pricing. Negligible.
- The worker concatenates objects instead of S3 doing it. It was going to read them anyway for ffmpeg.
- The `upload_id` column on `tracks` is no longer needed.
