import { pageMeta } from "@/content/site";
import { ToolPage } from "../tool-page";
import { ConsentCard } from "../tools/consent-card";

export const metadata = pageMeta({
  title: "Free recording consent form generator for interviews and podcasts · Tapry",
  description: "Make a plain-language consent form for recording an interview, podcast or research session: what is recorded, where it is kept, how it is used and how to withdraw. Free, no sign-up.",
  path: "/consent-form/",
});

const FAQ: Array<[string, string]> = [
  [
    "Do I need written consent to record an interview?",
    "It depends on where you and the other person are, and on what you do with the recording. Many places require everyone's agreement before a conversation is recorded, and publishing or research usually needs it in a form you can show later. A short written form that says what is recorded, why, where it is kept and how to withdraw covers the questions people actually have.",
  ],
  [
    "What should a recording consent form say?",
    "Who is recording and why; what is captured (voice, picture, screen); where the recording is stored, for how long and who can access it; whether it will be published and whether the person is named; and that they can stop, skip questions or ask for deletion, with someone to contact. This form covers each of those.",
  ],
  [
    "Is this legal advice?",
    "No. It is a clear starting point. Research reviewed by an ethics board, recordings of children, health information and broadcasting each have requirements of their own, and those differ by country. Have the final text checked where that matters.",
  ],
  ["Is what I type here stored?", "No. The form is put together on this page, in your browser. Nothing you type is sent to Tapry or anyone else."],
  [
    "How does Tapry handle consent?",
    "In Tapry, each studio has its own consent text. Every guest reads and accepts it before they can join, and each recording comes with a consent record: who was recorded, when each person agreed, and the exact text they agreed to.",
  ],
];

export default function ConsentFormPage() {
  return (
    <ToolPage
      title="Recording consent form generator"
      intro="Answer a few questions and get a plain-language consent form for an interview, a podcast or a research session, ready to copy or save. Nothing you type leaves this page."
      faq={FAQ}
    >
      <ConsentCard />
    </ToolPage>
  );
}
