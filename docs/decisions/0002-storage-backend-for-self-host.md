# 0002 — Self-host storage backend: MinIO is no longer a safe default

Status: **decided (30 Oct 2026): SeaweedFS is the bundled default** (`deploy/compose`). Any S3 that passes `test:s3` can replace it.

## What changed
The plan (`docs/plan/04-system-architecture.md`) uses MinIO as the default self-hosted storage.
On 30 Oct 2026, `https://dl.min.io/server/minio/release/darwin-arm64/minio` returned **HTTP 410 Gone**:
MinIO no longer publishes binaries for its open-source edition. Docker images should be assumed
affected too until checked.

## What works today
The API only speaks plain S3 (presigned PUT with signed `content-length` and
`x-amz-checksum-sha256`, HEAD with checksum mode, CreateBucket). Any backend that
supports those works. Verified so far:

| Backend | License | Verified | Notes |
|---|---|---|---|
| SeaweedFS 4.51 | Apache-2.0 | ✅ `pnpm --filter @opentake/web test:s3` | Rejects tampered content (400), wrong size (403), missing checksum header (403) |
| Garage | AGPL-3.0 | not yet | Small single binary, built for self-hosting |
| RustFS | Apache-2.0 | not yet | MinIO-compatible, younger project |
| Cloudflare R2 | — | not yet | Cloud target; check `x-amz-checksum-sha256` support on presigned PUT |

## Decision
Ship SeaweedFS 4.51 (`chrislusf/seaweedfs`) in Docker Compose: Apache-2.0, official image, and the
only candidate verified against our signed-upload guarantees. The full e2e flow passes on the
Compose stack. Garage, RustFS and R2 remain options for users: run `test:s3` against them first.
