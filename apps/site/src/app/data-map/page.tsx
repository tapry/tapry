import { pageMeta } from "@/content/site";
import { ToolPage } from "../tool-page";
import { DataMapCard } from "../tools/data-map-card";

export const metadata = pageMeta({
  title: "Free recording data map for GDPR: where interview and podcast recordings go · Tapry",
  description: "Write down what your recordings collect, where they are stored, who handles them and how long they are kept: a plain record of processing for interviews, podcasts and research. Free, no sign-up.",
  path: "/data-map/",
});

const FAQ: Array<[string, string]> = [
  [
    "What is a data map for recordings?",
    "A short written record of what you collect when you record people, why, where it is stored, who else handles it, how long it is kept and how someone can ask for their recording. Under the GDPR, organisations keep a record like this of their processing, and it is what a privacy notice and a consent form are written from.",
  ],
  [
    "Do I need one?",
    "If you record people in the EU or the UK for an organisation, for research or for anything beyond purely personal use, you are expected to know and be able to show where their data goes. Small organisations have lighter duties for occasional processing, but recording interviews regularly, or recording sensitive topics, is not occasional. Even where it is not required, it answers the questions an ethics board, a client or a guest will ask.",
  ],
  [
    "Is a voice recording personal data?",
    "Yes. A voice identifies a person, and so does a face, a name and what they say about themselves. A transcript is personal data too, even with the name removed, when what is said points to who said it.",
  ],
  [
    "Is this legal advice?",
    "No. It gives you the structure and plain wording. Which lawful basis fits, what a transfer outside Europe needs and how long you may keep recordings depend on your situation; have the final record checked where that matters.",
  ],
  ["Is what I type here stored?", "No. The record is put together on this page, in your browser. Nothing you type is sent to Tapry or anyone else."],
  [
    "How does Tapry help with this?",
    "Tapry can run on your own server, or record straight into your own storage bucket, so the answer to \"where is it stored\" is a place you control. Transcripts are made on the server by default, not by an outside service, each recording has a consent record, and a studio can delete its recordings after a set number of days.",
  ],
];

export default function DataMapPage() {
  return (
    <ToolPage
      title="Recording data map"
      intro="Answer a few questions and get a plain record of what your recordings collect, where they go and how long they stay: the base of a GDPR record of processing and of your privacy notice. Nothing you type leaves this page."
      faq={FAQ}
    >
      <DataMapCard />
    </ToolPage>
  );
}
