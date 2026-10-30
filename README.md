# OpenTake

Studio-quality remote recording you can own. Open source, self-hostable, recordings in your own storage.

> Early development. Nothing here is usable yet. See `docs/plan/` for the plan and `CLAUDE.md` for build rules.

## Layout

| Path | What |
|---|---|
| `packages/recorder` | Browser recording core: capture → MediaRecorder → durable local chunks → resumable upload (MIT) |
| `apps/` | Web app and worker (not started) |
| `docs/plan/` | Product and architecture plan |
| `docs/decisions/` | Architecture decision records |

## Self-host

See [docs/self-hosting.md](docs/self-hosting.md): `./setup.sh <domain> <email> && docker compose up -d` in `deploy/compose`.

## Develop

```bash
pnpm install
pnpm test
```
