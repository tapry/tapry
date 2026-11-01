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
