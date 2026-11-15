# Hero podcast footage

`podcast-turns-v4.mp4` and `podcast-turns-v4.webp` are an edited illustration using
real podcast studio footage from Mixkit. Demo participant names are fictional.
All three presenters replace the previous demo's cast.

| Participant | Source | Speaking take | Listening take |
| --- | --- | --- | --- |
| Yasmine | [Mixkit 2951](https://mixkit.co/free-stock-video/woman-recording-a-podcast-2951/) | 6.00–9.75 s | 0.00–4.50 s, forward and back once |
| Tom | [Mixkit 44048](https://mixkit.co/free-stock-video/man-chatting-in-a-studio-for-a-podcast-44048/) | 2.00–5.75 s | 8.00–17.00 s, continuous |
| Ines | [Mixkit 52184](https://mixkit.co/free-stock-video/a-mature-beautiful-woman-talking-lively-to-the-microphone-in-52184/) | 0.75–4.50 s | 6.00–10.50 s, forward and back once |

License: [Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree).
Each source page identifies the footage as available for commercial and personal
use under this license. Stock media is licensed separately from application code.

## Edit and playback

One 1472 × 360 H.264 MP4 contains three 480 × 360 feeds with 16-pixel gutters.
The 12.25-second, silent sequence uses full speaking turns and long listening
reactions. There are no sub-second reaction loops or changes in playback speed.
Yasmine and Ines each use a 4.5-second quiet reaction played forward and back once;
Tom's listening take runs forward continuously. Quarter-second blends soften
role handoffs. Each participant's speaking and listening takes use the same
source shot, wardrobe and setting.

The single video element keeps all faces on one media clock. Speaking outlines
and the recording clock follow the displayed frames through requestVideoFrameCallback,
with timeupdate as a compatibility fallback. Pausing stops the entire sequence.
The loop closes on its opening image during the final quiet gap to avoid a hard
reset. Source changes reload the existing video element, so live previews cannot
keep playing an older file after an update.

| Media time | Speaker |
| --- | --- |
| 0.00–0.50 | Quiet handoff |
| 0.50–3.75 | Yasmine |
| 3.75–4.50 | Quiet handoff |
| 4.50–7.75 | Tom |
| 7.75–8.50 | Quiet handoff |
| 8.50–11.75 | Ines |
| 11.75–12.25 | Quiet handoff |

Timing is mirrored in `src/components/hero-conversation.ts`. MP4 is encoded at
24 fps with fast-start metadata, no audio, and no inherited source metadata.
The WebP poster is the first frame. Versioned filenames prevent browsers from
reusing cached footage of the previous participants.
