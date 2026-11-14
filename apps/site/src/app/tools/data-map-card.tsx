"use client";

// The recording data map: a plain record of what a recording project collects, where it goes
// and how long it stays, filled in from a few answers. It is the kind of record the GDPR asks
// organisations to keep of their processing (Article 30) and the base of a privacy notice.
// Everything happens on this page; nothing typed here is sent anywhere.
import { useMemo, useState, type CSSProperties } from "react";

interface Answers {
  org: string;
  contact: string;
  project: string;
  purpose: string;
  basis: "consent" | "contract" | "legitimate" | "public" | "unsure";
  picture: boolean;
  transcript: boolean;
  special: boolean;
  recordingTool: string;
  storage: string;
  country: string;
  others: string;
  outside: "no" | "yes" | "unsure";
  howLong: string;
  access: string;
}

const START: Answers = {
  org: "",
  contact: "",
  project: "",
  purpose: "",
  basis: "consent",
  picture: true,
  transcript: true,
  special: false,
  recordingTool: "",
  storage: "",
  country: "",
  others: "",
  outside: "no",
  howLong: "",
  access: "",
};

const blank = (value: string, hint: string) => value.trim() || `[${hint}]`;

const BASIS: Record<Answers["basis"], string> = {
  consent: "Consent: each person agrees before they are recorded, and can withdraw.",
  contract: "Contract: the recording is needed for an agreement with the person recorded.",
  legitimate: "Legitimate interests: [say what the interest is, and why it does not override the person's own interests].",
  public: "Public task or research in the public interest: [name the task or the legal basis for the research].",
  unsure: "[To be decided: consent, contract, legitimate interests or a public task. Ask whoever advises you on data protection.]",
};

/** The record's text from the answers. Square brackets mark what is still to fill in. */
export function dataMap(a: Answers): string {
  const data = [
    "Voice recordings",
    ...(a.picture ? ["Video recordings (face and surroundings)"] : []),
    ...(a.transcript ? ["Written transcripts of what was said"] : []),
    "Names as given when joining",
    "Technical data needed to record: browser, device type, connection quality, times",
  ];
  const outside =
    a.outside === "no"
      ? "No. The data stays in the country or region named above."
      : a.outside === "yes"
        ? "Yes: [which country, which provider, and what protects the transfer, for example standard contractual clauses]."
        : "[To be checked with each provider listed above: where their servers and support staff are.]";
  return [
    `Recording data map`,
    ``,
    `Project: ${blank(a.project, "name of the podcast, study or programme")}`,
    `Responsible (controller): ${blank(a.org, "your organisation, or your own name")}`,
    `Contact for questions and requests: ${blank(a.contact, "name and email address")}`,
    ``,
    `1. Why we record`,
    `${blank(a.purpose, "what the recordings are for, in one or two sentences")}`,
    ``,
    `2. What allows it (lawful basis)`,
    BASIS[a.basis],
    ``,
    `3. Who is recorded`,
    `Guests, interviewees or participants, and the people on our side who run the session.`,
    ``,
    `4. What is collected`,
    ...data.map((d) => `- ${d}`),
    a.special
      ? `- The conversations may include sensitive information (health, beliefs, politics, sexual life, origin or similar). This needs explicit consent or another specific ground: [say which], and extra care with who has access.`
      : `- We do not ask for sensitive information (health, beliefs, politics and similar). If someone shares it anyway, it is handled with the same care and can be removed on request.`,
    ``,
    `5. Where it goes`,
    `- Recorded with: ${blank(a.recordingTool, "the recording tool, and whether you run it yourself or a company hosts it")}`,
    `- Stored at: ${blank(a.storage, "the storage: your own server, or the provider's name")}, in ${blank(a.country, "country or region")}`,
    `- Also handled by: ${blank(a.others, "anyone else who receives it: transcription, editing, publishing, cloud backup; or \"nobody else\"")}`,
    `- Each company above that handles the recordings for us does so under a data processing agreement.`,
    ``,
    `6. Does it leave the EU/EEA or the UK?`,
    outside,
    ``,
    `7. Who can access it`,
    `${blank(a.access, "the people or roles who can see and hear the recordings")}`,
    ``,
    `8. How long it is kept`,
    `${blank(a.howLong, "how long, and what happens then: for example, 12 months after publication, then deleted")}`,
    ``,
    `9. How it is protected`,
    `- Sent and stored encrypted; access only with a personal log-in.`,
    `- [Add what applies: two-step log-in, your own server, access reviewed every so often, originals deleted after editing.]`,
    ``,
    `10. People's rights`,
    `Anyone recorded can ask for a copy of their recording, for it to be corrected or deleted, or to withdraw their consent, by writing to the contact above. We answer within one month. They can also complain to their data protection authority.`,
    ``,
    `Last reviewed: ______________________________`,
    ``,
  ].join("\n");
}

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: "1px solid #e6e6e9", background: "#fff", color: "#0b0b0f", fontSize: 14.5, fontFamily: "inherit" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 500 };
const check: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 14.5, cursor: "pointer" };
const btn = (dark: boolean): CSSProperties => ({ display: "inline-flex", height: 38, alignItems: "center", borderRadius: 10, padding: "0 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: `1px solid ${dark ? "#0b0b0f" : "#e6e6e9"}`, background: dark ? "#0b0b0f" : "#fff", color: dark ? "#fff" : "#0b0b0f" });

export function DataMapCard() {
  const [a, setA] = useState<Answers>(START);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => dataMap(a), [a]);
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => setA((now) => ({ ...now, [key]: value }));
  const missing = (text.match(/\[[^\]]+\]/g) ?? []).length;
  const input = (key: "org" | "contact" | "project" | "recordingTool" | "storage" | "country" | "others" | "howLong" | "access", title: string, placeholder: string) => (
    <label style={label}>
      {title}
      <input style={field} value={a[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
    </label>
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  function save() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "Recording data map.txt" });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, border: "1px solid #ececef", borderRadius: 20, background: "#fff", padding: 22 }} data-testid="data-map-card">
      <div style={{ display: "grid", gap: 14 }}>
        {input("org", "Who is responsible", "Your organisation, or your own name")}
        {input("project", "Project", "The podcast, study or programme")}
        <label style={label}>
          Why you record
          <textarea style={{ ...field, minHeight: 64, resize: "vertical" }} value={a.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="What the recordings are for, in one or two sentences" />
        </label>
        <label style={label}>
          What allows it
          <select style={field} value={a.basis} onChange={(e) => set("basis", e.target.value as Answers["basis"])}>
            <option value="consent">Consent of the people recorded</option>
            <option value="contract">A contract with them</option>
            <option value="legitimate">Legitimate interests</option>
            <option value="public">A public task or research in the public interest</option>
            <option value="unsure">Not sure yet</option>
          </select>
        </label>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={check}>
            <input type="checkbox" checked={a.picture} onChange={(e) => set("picture", e.target.checked)} style={{ marginTop: 3 }} /> Video is recorded, not only sound
          </label>
          <label style={check}>
            <input type="checkbox" checked={a.transcript} onChange={(e) => set("transcript", e.target.checked)} style={{ marginTop: 3 }} /> Transcripts are made
          </label>
          <label style={check}>
            <input type="checkbox" checked={a.special} onChange={(e) => set("special", e.target.checked)} style={{ marginTop: 3 }} /> Conversations may cover health, beliefs, politics or similar
          </label>
        </div>
        {input("recordingTool", "What you record with", "The tool, and whether you run it yourself or a company hosts it")}
        {input("storage", "Where recordings are stored", "Your own server, or the provider's name")}
        {input("country", "In which country or region", "For example: Germany, or the EU")}
        {input("others", "Who else handles them", "Transcription, editing, publishing, backup; or: nobody else")}
        <label style={label}>
          Does any of it leave the EU/EEA or the UK?
          <select style={field} value={a.outside} onChange={(e) => set("outside", e.target.value as Answers["outside"])}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
            <option value="unsure">Not sure</option>
          </select>
        </label>
        {input("access", "Who can access the recordings", "The people or roles who can see and hear them")}
        {input("howLong", "How long they are kept", "For example: 12 months after publication, then deleted")}
        {input("contact", "Who people write to", "Name and email address")}
      </div>

      <pre data-testid="data-map-text" style={{ margin: 0, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", borderRadius: 14, background: "#f7f7f8", padding: 16, fontSize: 13.5, lineHeight: 1.55, fontFamily: "inherit", color: "#26262b" }}>
        {text}
      </pre>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn(true)} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy the record"}
        </button>
        <button type="button" style={btn(false)} onClick={save}>
          Save as a text file
        </button>
        <span role="status" style={{ fontSize: 13.5, color: "#6b6b70" }}>
          {missing > 0 ? `${missing} ${missing === 1 ? "blank" : "blanks"} left in square brackets` : "Every blank is filled in."}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#6b6b70" }}>
        A starting point in plain language, not legal advice. Which basis applies, what a transfer needs and how long you may keep recordings depend on your case and your country: have it checked where that matters.
      </p>
    </div>
  );
}
