// Starting points for a new studio: what a podcast, a research interview and a newsroom
// interview usually want, as settings and a guide. A template only fills the form in; everything
// stays changeable, and nothing here is kept on the studio as "its template".
import type { StudioSettings } from "@tapry/shared";

export interface StudioTemplate {
  id: "blank" | "podcast" | "research" | "newsroom" | "class";
  name: string;
  /** One line under the name. */
  about: string;
  guests: number;
  quality: "audio" | "720p" | "1080p";
  /** Settings beyond what the form shows. */
  settings: Partial<Pick<StudioSettings, "guestDownloads" | "audioFormat" | "deleteAfterDays">>;
  /** The consent text guests agree to; empty: the default. `{host}` is the host's name. */
  consent: string;
  /** The studio's guide: a line per item, # for sections. */
  guide: string;
  /** With this, the studio's solo link is switched on and asks this (a line per question): people record alone, without a call. */
  solo?: string;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  { id: "blank", name: "Blank", about: "Start from the defaults", guests: 3, quality: "1080p", settings: {}, consent: "", guide: "" },
  {
    id: "podcast",
    name: "Podcast",
    about: "A host and guests, video and sound",
    guests: 3,
    quality: "1080p",
    settings: {},
    consent: "",
    guide: ["# Opening", "Welcome and what today is about", "Introduce the guest", "# Conversation", "How did you get started?", "What are you working on now?", "# Closing", "Where can people find you?", "Thanks and what's next"].join("\n"),
  },
  {
    id: "research",
    name: "Research interview",
    about: "One participant, sound only, consent spelled out",
    guests: 1,
    quality: "audio",
    // Lossless at half the size, and the participant doesn't take a copy home unless you decide so.
    settings: { guestDownloads: false, audioFormat: "flac" },
    consent:
      "I agree to take part in this interview and to it being recorded. My voice is recorded on this device and sent to {host}. Taking part is voluntary: I can stop at any time, skip any question, and ask afterwards for my recording to be deleted.",
    guide: [
      "# Before you start",
      "Thank them, and say what the study is about",
      "Confirm they agree to be recorded and can stop at any time",
      "# Background",
      "Tell me a little about yourself and your role",
      "# Main questions",
      "Question 1",
      "Question 2",
      "Question 3",
      "# Closing",
      "Is there anything we didn't ask that we should have?",
      "Explain what happens with the recording next",
    ].join("\n"),
  },
  {
    id: "newsroom",
    name: "Newsroom interview",
    about: "A reporter and a source, with a producer if you like",
    guests: 2,
    quality: "1080p",
    settings: { guestDownloads: false },
    consent: "",
    guide: [
      "# Before recording",
      "On the record, on background or off the record?",
      "Name and title, spelled out",
      "# Interview",
      "What happened, in your own words?",
      "How do you know that?",
      "Who else should we talk to?",
      "# Before you stop",
      "Anything to add or correct?",
      "Best way to reach you for follow-up",
    ].join("\n"),
  },
  {
    id: "class",
    name: "Class",
    about: "Students record alone on a link, no accounts",
    guests: 3,
    quality: "1080p",
    // Students keep their own file; the class's recordings go after a term.
    settings: { guestDownloads: true, deleteAfterDays: 120 },
    consent: "",
    guide: ["# In a live session", "Welcome and today's task", "Each group presents", "Questions and feedback", "# After", "What to hand in, and by when"].join("\n"),
    solo: ["# Your assignment", "Say your name and your group", "Present your work in your own words (up to 10 minutes)", "What would you do differently next time?"].join("\n"),
  },
];

/** The consent text of a template for this host. */
export const templateConsent = (t: StudioTemplate, hostName: string) => t.consent.replace("{host}", () => hostName);
