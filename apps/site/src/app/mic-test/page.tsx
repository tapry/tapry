import { pageMeta } from "@/content/site";
import { ToolPage } from "../tool-page";
import { MicCard } from "../tools/mic-card";

export const metadata = pageMeta({
  title: "Free mic test: check your microphone and camera online · Tapry",
  description: "Test your microphone and webcam in your browser: see your level, hear yourself back, and check your camera’s resolution. Free, no sign-up, nothing leaves your computer.",
  path: "/mic-test/",
});

const FAQ: Array<[string, string]> = [
  [
    "Why does my microphone sound quiet?",
    "Most often the mic is too far away, or its input level is turned down. Sit about a hand’s width to a forearm’s length from it and raise the input level in your system’s sound settings until the test above says the level sounds good while you talk.",
  ],
  [
    "Why do I sound like a phone call on my Bluetooth headset?",
    "When a Bluetooth headset’s microphone is in use, the headset switches to its call mode, which carries much less of your voice. Keep the headset for listening and speak into your computer’s microphone or a USB mic instead.",
  ],
  [
    "My browser says the microphone or camera is blocked. What now?",
    "Click the camera or lock icon in the address bar, allow the microphone and camera for this page, and reload. On a Mac, also check System Settings › Privacy & Security › Microphone and Camera.",
  ],
  [
    "Do you record or keep anything?",
    "No. The meter and the test recording happen on this page, in your browser. Nothing is uploaded, and the test recording is gone when you close the tab.",
  ],
];

export default function MicTestPage() {
  return (
    <ToolPage
      title="Mic and camera test"
      intro="Check how you sound and look before a podcast, interview or call: your level, a recording you can play back, and your camera’s real resolution. Nothing leaves your computer."
      faq={FAQ}
    >
      <MicCard />
    </ToolPage>
  );
}
