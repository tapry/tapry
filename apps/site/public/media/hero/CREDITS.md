# Hero podcast footage

`podcast-turns-v3.mp4` and `podcast-turns-v3.webp` are an edited illustration using
real podcast studio footage from Mixkit. Demo participant names are fictional.

| Participant | Speaking take | Listening take |
| --- | --- | --- |
| Yasmine | [Mixkit 52195](https://mixkit.co/free-stock-video/a-mature-woman-wearing-a-blazer-is-in-front-of-52195/) | Same source, quiet reaction |
| Tom | [Mixkit 44028](https://mixkit.co/free-stock-video/portrait-of-a-man-speaking-on-a-podcast-44028/) | [Mixkit 44050](https://mixkit.co/free-stock-video/recording-a-video-podcast-44050/) |
| Ines | [Mixkit 52186](https://mixkit.co/free-stock-video/a-mature-black-woman-with-abundant-curly-hair-engaging-in-52186/) | [Mixkit 52185](https://mixkit.co/free-stock-video/a-smiling-mature-black-woman-with-curly-hair-comfortably-seated-52185/) |

License: [Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree).
Each source page identifies the footage as available for commercial and personal
use under this license. Stock media is licensed separately from application code.

## Edit and playback

One 1472 × 360 H.264 MP4 contains three 480 × 360 feeds with 16-pixel gutters.
The 12.25-second, silent sequence uses full speaking turns and long listening
reactions. There are no sub-second reaction loops or changes in playback speed.
Yasmine's 4.5-second quiet reaction is mirrored once; the other listening takes
run forward continuously. Quarter-second blends soften the role handoffs.
Tom's listening crop follows the original camera movement to keep him centered.

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
The WebP poster is the first frame. The versioned filenames replace the old demo
rather than reusing a potentially cached copy of the glitching footage.
