import { pageMeta } from "@/content/site";
import { ToolPage } from "../tool-page";
import { RecorderCard } from "../tools/recorder-card";

export const metadata = pageMeta({
  title: "Free online voice and video recorder, saved to your computer · Tapry",
  description: "Record your voice, or your voice and camera, in the browser and save the file to your own computer. Free, no sign-up, and nothing is uploaded.",
  path: "/recorder/",
});

const FAQ: Array<[string, string]> = [
  ["Where does my recording go?", "Nowhere. It is recorded in this browser tab and stays there until you save it to your computer. It is never uploaded, and closing the tab removes it."],
  [
    "What format is the file?",
    "The one your browser records in: WebM with Opus sound in Chrome and Firefox, MP4 in most versions of Safari. Both open in current browsers and editors; VLC plays either.",
  ],
  ["How long can I record?", "Up to an hour. The recording is held in the tab's memory until you save it, so very long ones are better made with software that writes to disk as it goes."],
  [
    "Why does it sound different from a call?",
    "Calls process your voice: they cut echo, hide background noise and even out the level. This recorder turns that off so you hear your microphone as it is. Use headphones if you play sound while recording.",
  ],
  [
    "Can I record someone else with this?",
    "Only who is at this computer. To record a conversation with people elsewhere, each in full quality on their own computer, that is what Tapry does.",
  ],
];

export default function RecorderPage() {
  return (
    <ToolPage title="Voice and video recorder" intro="Record yourself in the browser, with or without your camera, and save the file to your own computer. No sign-up, and nothing is uploaded." faq={FAQ}>
      <RecorderCard />
    </ToolPage>
  );
}
