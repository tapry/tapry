# Third-party software

Tapry's own code is under the AGPL-3.0 ([LICENSE](LICENSE)), except `packages/recorder`
(MIT). It builds on the software below, each under its own license.

## npm packages

Bundled into the web app and worker. All are under permissive licenses compatible with the
AGPL: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, plus `caniuse-lite` data (CC-BY-4.0) and
`@bufbuild/protobuf` (Apache-2.0 and BSD-3-Clause). The image library Next.js uses, libvips
(through `sharp`), is LGPL-3.0-or-later and is dynamically linked. To list them all:

```bash
pnpm -r licenses list --prod
```

## Served to browsers by the web app

Background blur works out where a person is in their camera picture on their own device. What
it needs is served by the Tapry server itself (`apps/web/public`), never from a CDN.

| Software | License | Where |
|---|---|---|
| [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.21 (JavaScript and WebAssembly runtime) | Apache-2.0 | npm package; its `wasm/` files are copied to `apps/web/public/mediapipe/` by `apps/web/scripts/copy-mediapipe.mjs` before `next dev` and `next build` |
| MediaPipe Selfie Segmenter model, `selfie_segmenter.tflite` (float16) | Apache-2.0 | `apps/web/public/models/selfie_segmenter.tflite`, in this repository |

The model was downloaded on 12 Nov 2026 from
<https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite>
(249,537 bytes, SHA-256 `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`).
Its model card is linked from the
[MediaPipe image segmenter documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter#selfie-model).

## In the Docker images

| Software | License | Where |
|---|---|---|
| [FFmpeg](https://ffmpeg.org) (Debian package, built with libx264) | GPL-2.0-or-later | `tapry-web` image; run as a separate program |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | `tapry-web` image, built from source |
| Whisper `base` model ([ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)), from OpenAI Whisper | MIT | `tapry-web` image |
| Silero VAD model ([ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad)) | MIT | `tapry-web` image |
| DejaVu fonts | Bitstream Vera / public domain | `tapry-web` image (names on the combined video) |
| Node.js and Debian bookworm base | MIT and various free licenses | `tapry-web` image |
| [Caddy](https://caddyserver.com) and [caddy-l4](https://github.com/mholt/caddy-l4) | Apache-2.0 | `tapry-caddy` image |

The source of every Debian package in the image is available from
[sources.debian.org](https://sources.debian.org) (`apt-get source <package>` on bookworm).

## Services the Compose stack runs (unmodified upstream images)

| Software | License |
|---|---|
| [LiveKit server](https://github.com/livekit/livekit) | Apache-2.0 |
| [PostgreSQL](https://www.postgresql.org) | PostgreSQL License |
| [SeaweedFS](https://github.com/seaweedfs/seaweedfs) | Apache-2.0 |
