# Browser support

What is **tested**, not what should work. Per `CLAUDE.md`, claims here must match the test
matrix. Last run: 30 Oct 2026, macOS (Apple Silicon), Playwright 1.64.

## Recording (record → upload → process → download)

`e2e/matrix.spec.ts`, one run per engine, with fake camera and microphone:

| Engine | Version | Records as | Result |
|---|---|---|---|
| Chromium | Chrome for Testing 156 | WebM VP9 + Opus | ✅ |
| Firefox | 157 | WebM **VP8** + Opus (no VP9 in Firefox's MediaRecorder) | ✅ |
| WebKit | 27.2 (Playwright build) | WebM VP9 + Opus | ✅ |
| WebKit, MP4 only | 27.2, WebM hidden | **MP4** (H.264 + AAC), the path of Safari < 18.4 and iOS | ✅ |

Each run checks: the green room preview and mic meter, one audio-only and one camera recorder
in the expected format, all chunks uploaded, processing to WAV + MP4 + combined video, every
download a valid file, all outputs the same length.

**Not tested:** real Safari on macOS/iOS (WebKit is the same engine, but Playwright's build
isn't Safari: codecs and permission prompts can differ), Edge (Chromium-based), Android Chrome,
real cameras and microphones. Recording on phones also stops when the tab is backgrounded;
the green room warns about it.

## Live call

| Engine | Result |
|---|---|
| Chromium | ✅ two participants see and hear each other, mute propagates (`e2e/studio.spec.ts`) |
| Firefox, WebKit | not yet covered by a two-person test |

## Reliability (Chromium)

| Scenario | Test | Result |
|---|---|---|
| Upload capped at 1 Mbit/s, 200 ms latency, 30% of upload requests failing | `reliability.spec.ts` | ✅ every chunk arrives, files complete |
| Guest offline mid-recording, tab closed, comes back later | `studio.spec.ts` | ✅ leftovers upload on return, track completed |
| Tab killed while offline mid-recording, rejoins while still recording | `reliability.spec.ts` | ✅ offline chunks recovered; both pieces merged into one file per kind |
| 10-minute recording (`E2E_LONG_MINUTES=10`) | `long.spec.ts` (opt-in) | ✅ page heap 59.8 MB at 1 min → 50.5 MB at 10 min (no growth); uploads never behind (~7 MB/min sent); every output ≥ 598 s, all equal length; processed in ~1 min |

Not yet run: 60- and 120-minute recordings (the plan's release gate), laptop sleep, disk nearly
full. The long test takes `E2E_LONG_MINUTES=60` when there's time to run it.

A true renderer crash (DevTools `Page.crash`) hangs Playwright with this Chromium build, so the
"tab killed" case closes the tab abruptly instead (no `beforeunload`, nothing flushed).

## Browser-specific behaviour worth knowing

- **Firefox** asks the user before granting persistent storage. Joining must never wait for
  that answer (it used to, which froze the join button until the guest clicked the prompt).
- **Cross-origin downloads:** page scripts can't read `Content-Disposition` from the signed
  storage URL; real downloads (clicking the link) still get the right file name.
