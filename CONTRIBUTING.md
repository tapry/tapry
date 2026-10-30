# Contributing

Thanks for helping. Bug reports with browser details are as valuable as code.

## Reporting

- **Bugs:** open an issue with the bug template. Say which browser and OS each participant
  used, and what the host's recordings page showed. Logs never contain media, so server logs
  (`docker compose logs web worker`) are safe to attach.
- **A browser that doesn't work:** use the browser report template; it feeds
  [docs/browser-support.md](docs/browser-support.md).
- **Security problems:** not in issues. See [SECURITY.md](SECURITY.md).

## Code

Set up with [docs/dev-setup.md](docs/dev-setup.md). Before writing code, read
[CLAUDE.md](CLAUDE.md): it holds the project's rules, and the first one matters most. **A local
chunk is never deleted until the server has confirmed it.** Losing a recording is the worst
bug this project can have.

- Every recording or sync bug gets a regression test.
- `pnpm typecheck && pnpm test` must pass; run the e2e tests for anything that touches
  recording, uploads or processing.
- Keep `packages/recorder` free of framework code and heavy dependencies.
- Claims about browsers must match what the tests cover.
- Match the style around you: plain names, comments that say why.

## Sign-off (DCO)

Contributions are accepted under the project's licenses (AGPL-3.0, MIT for
`packages/recorder`). Sign off each commit to certify you wrote it or have the right to submit
it, per the [Developer Certificate of Origin](https://developercertificate.org):

```bash
git commit -s
```

This adds `Signed-off-by: Your Name <you@example.com>` to the commit message.
