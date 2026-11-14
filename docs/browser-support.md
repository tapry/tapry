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

**Not tested:** real Safari on macOS/iOS, apart from the sync run further down (WebKit is the same engine, but Playwright's build
isn't Safari: codecs and permission prompts can differ), Edge (Chromium-based), Android Chrome,
real cameras and microphones. Recording on phones also stops when the tab is backgrounded;
the green room warns about it.

**Phones.** `e2e/phone.spec.ts` takes a guest from the invite to the end screen in Chromium at a
phone's size with touch: nothing wider than the screen, form fields at 16 px (iOS zooms into
smaller ones), stage buttons 44 px, and the recording arrives. The room asks the browser to
keep the screen on (Screen Wake Lock) while the session runs and until the upload is done;
where a phone's browser has no wake lock, the room says to keep the screen on. This is a
desktop engine at a phone's size: **no real iPhone or Android phone has been tried**, so phones
stay outside the supported matrix.

## Screen sharing

Tested end to end in Chromium only (Chrome for Testing 156, host shares, guest watches, the
screen is recorded and processed: `e2e/screen.spec.ts`). Firefox and Safari have the same
browser features (`getDisplayMedia`, MediaRecorder) but have not been tried. Phones can't share
a screen from the browser, so the button isn't shown there.

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

## Sync (Chromium)

`e2e/sync.spec.ts`: two browsers whose microphones beep on every whole second of the real
clock, so each beep happens at the same instant for both; the guest's device clock is set 3.7 s
wrong. After processing, each beep is found in each person's WAV (`E2E_SYNC_SECONDS`, default 20).

| Length | Between the two people (worst) | Against the Record moment | Drift start → end | Beeps found |
|---|---|---|---|---|
| 20 s | 0.8 ms | 13–14 ms | 0 ms | 19 / 19 |
| 5 min | 5.4 ms | 14–20 ms | 0 ms | 299 / 299 |
| 60 min (Gate A) | 4.3 ms | 26–44 ms | 0 ms | 3,601 / 3,601 |

Plan target (Gate A): under 50 ms between people, with no lost audio. The 60-minute run (1 Nov 2026)
also checks that every output file runs the whole recording (within 0.1 s) and that every beep is
in both files. With the clock-offset correction switched off, the same test fails (beeps ~300 ms
apart). `E2E_SYNC_SKEW=host` puts the wrong clock on the host instead (same results).

## Sync and zero loss (real Safari)

`E2E_SYNC_GUEST=safari` makes the guest real Safari on macOS, driven by Apple's `safaridriver`
(Safari > Settings > Advanced > "Show features for web developers", then Developer > "Allow
remote automation"). The host stays Chromium, with the wrong clock; Safari keeps its camera on.

Automated Safari only has mock devices. Its Web Audio clock stalls for hundreds of ms at a time
there, so beeps can't be generated in it; its mock microphone bursts every 1.000 s instead, through
the same capture → MediaRecorder → upload → processing path as a real mic, at a phase we can't
know. So the Safari run checks that every burst is in Safari's file, exactly a second after the
last, from end to end (nothing lost, no drift against real time), and that every file runs the
whole recording. It doesn't measure the absolute gap between a Safari guest and the host: that
needs real devices.

| Length | Safari bursts found | Spacing (min–max) | Files full length |
|---|---|---|---|
| 2 min | 119 / 119 | 999.9–1000.1 ms | ✓ |
| 60 min (Gate A) | 3,601 / 3,601 | 999.9–1000.1 ms | ✓ |

The 60-minute run's Safari track was perfect. The test itself failed at the time on the host's
side: the host's generated beeps shifted about 740 ms when Safari started encoding and stayed
there, outside the old ±400 ms search window. The host's raw audio, rebuilt from its 896 uploaded
chunks, has every one of its 3,602 beeps: nothing was lost. The check now counts the host's beeps
the same way as Safari's bursts (passes at 2 min); the hour hasn't been rerun with it.

The gap between Safari and the host is reported, not checked: with both browsers on one machine,
headless Chromium's generated beeps stall for a few hundred ms while Safari starts encoding (the
host's own track jumps; Safari's stays even).

**Not covered:** each device's own input delay. A Bluetooth headset can add 100–200 ms before
the browser sees the sound, and timestamps can't know it; lining tracks up by the audio itself
(cross-correlation) would be the way to catch that.

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
