"use client";

// The consent form generator: a plain-language recording consent form, filled in from a few
// answers, to copy or save. Everything happens on this page; nothing typed here is sent anywhere.
import { useMemo, useState, type CSSProperties } from "react";

interface Answers {
  who: string;
  project: string;
  purpose: string;
  picture: boolean;
  screen: boolean;
  transcript: boolean;
  where: string;
  howLong: string;
  access: string;
  published: "no" | "excerpts" | "full";
  named: boolean;
  contact: string;
}

const START: Answers = {
  who: "",
  project: "",
  purpose: "",
  picture: true,
  screen: false,
  transcript: true,
  where: "",
  howLong: "",
  access: "",
  published: "no",
  named: true,
  contact: "",
};

const blank = (value: string, hint: string) => value.trim() || `[${hint}]`;

/** The form's text from the answers. Square brackets mark what is still to fill in. */
export function consentForm(a: Answers): string {
  const recorded = ["your voice", ...(a.picture ? ["your picture"] : []), ...(a.screen ? ["anything you choose to share from your screen"] : [])];
  const list = recorded.length === 1 ? recorded[0] : `${recorded.slice(0, -1).join(", ")} and ${recorded.at(-1)}`;
  const published =
    a.published === "no"
      ? "The recording will not be published."
      : a.published === "excerpts"
        ? "Short excerpts of the recording may be published or quoted. The full recording will not be published."
        : "The recording may be published in full.";
  return [
    `Consent to be recorded`,
    ``,
    `Project: ${blank(a.project, "name of the project, programme or study")}`,
    `Recorded by: ${blank(a.who, "your name or organisation")}`,
    ``,
    `What this is for`,
    `${blank(a.purpose, "why you are recording, in one or two sentences")}`,
    ``,
    `What is recorded`,
    `The conversation is recorded: ${list}.${a.transcript ? " A written transcript is made from the recording." : ""}`,
    ``,
    `Where it is kept and for how long`,
    `The recording is stored ${blank(a.where, "where: for example, on our own server in Germany")} and kept ${blank(a.howLong, "how long: for example, for 12 months, then deleted")}.`,
    `It can be seen and heard by ${blank(a.access, "who: for example, the two researchers on this project")}.`,
    ``,
    `How it is used`,
    published,
    a.named ? "You may be named when the recording or quotes from it are used." : "You will not be named. Quotes from you will be used without your name or details that identify you.",
    ``,
    `Your choices`,
    `Taking part is voluntary. You can stop the recording at any time, skip any question, and ask for all or part of your recording to be deleted afterwards, without giving a reason. To do that, or to ask anything about this recording, contact ${blank(a.contact, "name and email address")}.`,
    ``,
    `Agreement`,
    `I have read and understood the above, and I agree to be recorded.`,
    ``,
    `Name: ______________________________`,
    ``,
    `Date: ______________________________`,
    ``,
    `Signature: ______________________________`,
    ``,
  ].join("\n");
}

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: "1px solid #e6e6e9", background: "#fff", color: "#0b0b0f", fontSize: 14.5, fontFamily: "inherit" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 500 };
const check: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 14.5, cursor: "pointer" };
const btn = (dark: boolean): CSSProperties => ({ display: "inline-flex", height: 38, alignItems: "center", borderRadius: 10, padding: "0 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: `1px solid ${dark ? "#0b0b0f" : "#e6e6e9"}`, background: dark ? "#0b0b0f" : "#fff", color: dark ? "#fff" : "#0b0b0f" });

export function ConsentCard() {
  const [a, setA] = useState<Answers>(START);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => consentForm(a), [a]);
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => setA((now) => ({ ...now, [key]: value }));
  const missing = (text.match(/\[[^\]]+\]/g) ?? []).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  function save() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "Recording consent form.txt" });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, border: "1px solid #ececef", borderRadius: 20, background: "#fff", padding: 22 }} data-testid="consent-card">
      <div style={{ display: "grid", gap: 14 }}>
        <label style={label}>
          Who is recording
          <input style={field} value={a.who} onChange={(e) => set("who", e.target.value)} placeholder="Your name or organisation" />
        </label>
        <label style={label}>
          Project
          <input style={field} value={a.project} onChange={(e) => set("project", e.target.value)} placeholder="The podcast, study or programme" />
        </label>
        <label style={label}>
          What it is for
          <textarea style={{ ...field, minHeight: 64, resize: "vertical" }} value={a.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Why you are recording, in one or two sentences" />
        </label>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={check}>
            <input type="checkbox" checked={a.picture} onChange={(e) => set("picture", e.target.checked)} style={{ marginTop: 3 }} /> Their picture is recorded, not only their voice
          </label>
          <label style={check}>
            <input type="checkbox" checked={a.screen} onChange={(e) => set("screen", e.target.checked)} style={{ marginTop: 3 }} /> They may share their screen
          </label>
          <label style={check}>
            <input type="checkbox" checked={a.transcript} onChange={(e) => set("transcript", e.target.checked)} style={{ marginTop: 3 }} /> A transcript is made
          </label>
          <label style={check}>
            <input type="checkbox" checked={a.named} onChange={(e) => set("named", e.target.checked)} style={{ marginTop: 3 }} /> They may be named
          </label>
        </div>
        <label style={label}>
          Where the recording is stored
          <input style={field} value={a.where} onChange={(e) => set("where", e.target.value)} placeholder="For example: on our own server in Germany" />
        </label>
        <label style={label}>
          How long it is kept
          <input style={field} value={a.howLong} onChange={(e) => set("howLong", e.target.value)} placeholder="For example: for 12 months, then deleted" />
        </label>
        <label style={label}>
          Who can see and hear it
          <input style={field} value={a.access} onChange={(e) => set("access", e.target.value)} placeholder="For example: the two researchers on this project" />
        </label>
        <label style={label}>
          Will it be published?
          <select style={field} value={a.published} onChange={(e) => set("published", e.target.value as Answers["published"])}>
            <option value="no">No</option>
            <option value="excerpts">Short excerpts or quotes only</option>
            <option value="full">Yes, in full</option>
          </select>
        </label>
        <label style={label}>
          Who to contact to withdraw or ask questions
          <input style={field} value={a.contact} onChange={(e) => set("contact", e.target.value)} placeholder="Name and email address" />
        </label>
      </div>

      <pre data-testid="consent-text" style={{ margin: 0, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", borderRadius: 14, background: "#f7f7f8", padding: 16, fontSize: 13.5, lineHeight: 1.55, fontFamily: "inherit", color: "#26262b" }}>
        {text}
      </pre>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn(true)} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy the form"}
        </button>
        <button type="button" style={btn(false)} onClick={save}>
          Save as a text file
        </button>
        <span role="status" style={{ fontSize: 13.5, color: "#6b6b70" }}>
          {missing > 0 ? `${missing} ${missing === 1 ? "blank" : "blanks"} left in square brackets` : "Every blank is filled in."}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#6b6b70" }}>
        A starting point in plain language, not legal advice. Research with an ethics board, work with children, health data and publishing each bring rules of their own: check what applies to you.
      </p>
    </div>
  );
}
