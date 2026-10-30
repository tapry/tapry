# Local development setup (macOS, no Docker)

Everything below runs without sudo, Homebrew or Docker. Put the binaries anywhere; the
paths go into `apps/web/.env.local` and the test commands.

| Tool | Why | Get it |
|---|---|---|
| Node 22 + pnpm | everything | nodejs.org tarball → `~/.local/node`; `corepack enable` |
| SeaweedFS | S3 storage for dev and tests (MinIO no longer ships binaries, see `docs/decisions/0002`) | `darwin_arm64.tar.gz` from github.com/seaweedfs/seaweedfs/releases (check the `.md5`) |
| ffmpeg + ffprobe | recording processing | `ffmpeg-darwin-arm64.gz` / `ffprobe-darwin-arm64.gz` from github.com/eugeneware/ffmpeg-static/releases |
| LiveKit server | the live call | build from source (below): LiveKit publishes no macOS binaries |
| whisper.cpp + model | transcripts (optional) | build `whisper-cli` from the github.com/ggml-org/whisper.cpp release tarball with CMake (cmake.org macOS tarball); `ggml-base.bin` and `ggml-silero-v6.2.0.bin` from Hugging Face (check the SHA-256s in `deploy/docker/web.Dockerfile`) |
| Playwright Chromium | e2e tests | `pnpm --filter @opentake/web exec playwright install chromium` |

## Building LiveKit on macOS

Needs Go (go.dev tarball, check its SHA-256). Without Xcode command line tools there is no C
compiler, so build with `CGO_ENABLED=0`, which needs one patch:
`github.com/livekit/protocol/utils/hwstats` reads CPU stats through a cgo-only library on macOS.

```bash
VERSION=v1.13.11
SRC=$(go mod download -json github.com/livekit/livekit-server@$VERSION | grep '"Dir"' | cut -d'"' -f4)
cp -R "$SRC" livekit-src && chmod -R u+w livekit-src && cd livekit-src
# `go install pkg@version` refuses modules with replace directives; build it as the main module.
PROTO=$(go list -m -f '{{.Dir}}' github.com/livekit/protocol)
cp -R "$PROTO" third_party-protocol && chmod -R u+w third_party-protocol
H=third_party-protocol/utils/hwstats
sed -i '' '15s#^#//go:build linux || (darwin \&\& cgo)\n\n#' $H/cpu_all.go
sed -i '' 's#^//go:build darwin$#//go:build darwin \&\& cgo#' $H/cpu_darwin.go
sed -i '' 's#^//go:build !(linux || darwin)$#//go:build !(linux || darwin) || (darwin \&\& !cgo)#' $H/cpu_null.go
go mod edit -replace github.com/livekit/protocol=./third_party-protocol
CGO_ENABLED=0 go build -trimpath -o livekit-server ./cmd/server
```

Effect of the patch: LiveKit reports no CPU load on macOS. Calls work the same. Production
uses LiveKit's official Linux image, which is unaffected.

## Running

```bash
weed server -dir=… -ip=127.0.0.1 -ip.bind=127.0.0.1 -master.port=29334 -volume.port=28081 \
  -filer -filer.port=28889 -s3 -s3.port=8333 -s3.config=s3.json   # credentials as in .env.local
livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1           # devkey / secret on :7880
pnpm --filter @opentake/web dev
```

Note: SeaweedFS also listens on each port + 10000 (gRPC). The test wrapper uses ports that
don't collide with the dev instance above.

## Tests

```bash
FFMPEG_PATH=… FFPROBE_PATH=… pnpm test
WEED_BIN=… LIVEKIT_BIN=… FFMPEG_PATH=… FFPROBE_PATH=… pnpm --filter @opentake/web test:e2e
```

Add `WHISPER_PATH=… WHISPER_MODEL=… WHISPER_VAD_MODEL=…` (and `apps/web/.env.local`) for transcripts.
Without `FFMPEG_PATH` the media tests are skipped; without `WHISPER_MODEL` the transcription
tests are; without `LIVEKIT_BIN` the e2e call step is
skipped (recording is still tested end to end).

## Testing TURN like a real server

Host networking on macOS (OrbStack / Docker Desktop) runs inside their own VM, so the TURN
test uses a Linux machine: `orb create ubuntu:noble opentake-vm`, install `docker.io` and
`docker-compose-v2` in it, load the images (`docker save … | orb -m opentake-vm sudo docker load`),
and start the stack there with an env file whose `LIVEKIT_NODE_IP` and
`LIVEKIT_TURN_ALLOW_PEERS` are the VM's IP, plus `-f docker-compose.turn-test.yml` (TURN over
UDP off, so 443 is the only path). Then from the Mac:

```bash
VM=<vm ip>
E2E_BASE_URL=http://opentake.test E2E_TURN=1 \
E2E_CHROMIUM_ARGS="[\"--host-resolver-rules=MAP opentake.test $VM, MAP *.opentake.test $VM\", \"--unsafely-treat-insecure-origin-as-secure=http://opentake.test,http://s3.opentake.test\"]" \
  pnpm --filter @opentake/web exec playwright test turn.spec.ts --project chromium
```
