# Browser support

What is **tested**, not what should work. Per `CLAUDE.md`, claims here must match the test
matrix. Last run: 31 Oct 2026, macOS (Apple Silicon), Playwright 1.64.

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

`e2e/call.spec.ts`: the host in each engine with a guest in Chromium, plus Firefox and WebKit
calling each other (each hosting once), everyone with camera and mic.
Each run checks both directions: the host's camera plays for the guest at no more than 360p
and the guest's for the host, the sound measured from what actually arrives; mute reaches the
other side and silences the recorded mic; and the call leaves the recorded camera track
untouched.

| Host | Guest | Result |
|---|---|---|
| Chromium 156 | Chromium | ✅ |
| Firefox 157 | Chromium | ✅ (the call's video is scaled down in the encoder: Firefox ignores size constraints on a cloned camera track) |
| WebKit 27.2 (Playwright build) | Chromium | ✅ |
| Firefox 157 | WebKit | ✅ |
| WebKit 27.2 | Firefox | ✅ |

The test LiveKit sends media on the machine's network address, as a real server would
(Firefox doesn't use loopback candidates), with Firefox at its default settings. Also covered:
a call that can't connect retries one attempt at a time, and the host and guest flow in
`e2e/studio.spec.ts` (Chromium).

**Not tested:** real Safari (WebKit is the same engine, but Playwright's build isn't Safari),
phones, and calls over the internet rather than one machine (TURN has its own test,
`e2e/turn.spec.ts`, against a Linux host).

## Reliability (Chromium)

| Scenario | Test | Result |
|---|---|---|
| Upload capped at 1 Mbit/s, 200 ms latency, 30% of upload requests failing | `reliability.spec.ts` | ✅ every chunk arrives, files complete |
| Guest offline mid-recording, tab closed, comes back later | `studio.spec.ts` | ✅ leftovers upload on return, track completed |
| Tab killed while offline mid-recording, rejoins while still recording | `reliability.spec.ts` | ✅ offline chunks recovered; both pieces merged into one file per kind |
| A guest's tab goes to the background, then closes | `alerts.spec.ts` | ✅ the host sees "Tab in background" at once, then "Not reporting" within 15 s |
| Recorders slow to stop after Stop (2.5 s) | `reliability.spec.ts` | ✅ "uploaded" only once every track is complete on the server; until then the page says it's finishing and warns before closing |
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
