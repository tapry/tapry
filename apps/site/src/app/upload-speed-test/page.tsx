import type { Metadata } from "next";
import { ToolPage } from "../tool-page";
import { UploadSpeedTest } from "./upload-speed-test";

export const metadata: Metadata = {
  title: "Upload speed test for podcasts, interviews and video: is your internet good enough to record? · Tapry",
  description:
    "Test your upload speed and see whether it keeps up with recording a podcast or interview in sound only, 720p or 1080p video. Free, no sign-up.",
  alternates: { canonical: "/upload-speed-test" },
};

const FAQ: Array<[string, string]> = [
  [
    "Why upload, not download?",
    "When you record a remote podcast or interview, your own voice and video travel from your computer to the others. That’s your upload, and on most home connections it’s far slower than the download speed you pay for.",
  ],
  [
    "How much upload do I need to record a podcast?",
    "Sound only needs very little: under 0.2 Mbit/s. Video in 720p needs about 5 Mbit/s and Full HD 1080p about 9 Mbit/s to keep up while you record, including the live call.",
  ],
  [
    "What happens if my upload is too slow?",
    "With Tapry, nothing is lost: everything is recorded on your own computer first and sent as fast as your line allows. A slow upload only means it finishes after the session, so keep the page open until it says it’s done.",
  ],
  [
    "How do I get a faster upload?",
    "Plug into your router with a cable if you can, or sit close to the Wi-Fi. Pause cloud backups, large downloads and video streams on your network while you record.",
  ],
];

export default function UploadSpeedTestPage() {
  return (
    <ToolPage
      title="Is your internet good enough to record?"
      intro="Test your upload speed and see whether it keeps up with recording a podcast or interview: sound only, 720p or Full HD video. Takes about five seconds; the test data is thrown away."
      faq={FAQ}
    >
      <UploadSpeedTest />
    </ToolPage>
  );
}
