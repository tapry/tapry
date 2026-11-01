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

## Contributor License Agreement

Before your first pull request is merged, you accept the [CLA](CLA.md) once. You keep the
copyright in your work. The CLA lets the project license Tapry as a whole, including under
commercial terms that fund its development, and promises that every contribution stays
available as open source.

To sign, comment this on your pull request (a check called **CLA** explains it when you open
one):

```
I have read the Tapry CLA and I agree to it.
```

It covers all your future contributions. Commits must use an email that is on your GitHub
account, so the check can tell who wrote them.
