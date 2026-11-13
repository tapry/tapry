// Share-safe transcripts: a copy of a transcript with speakers' names replaced by neutral ones
// and email addresses, phone numbers, web addresses and listed words masked. Made on request
// from the stored captions and never stored: the recording's own transcript is untouched.
// Text only: the sound and picture still say what was said.
import { toDocx, toSrt, toTxt, toVtt, type Line } from "@tapry/worker";

export const SAFE_FORMATS = ["txt", "docx", "srt", "vtt"] as const;
export type SafeFormat = (typeof SAFE_FORMATS)[number];

export interface SafeOptions {
  /** Speakers become "Speaker 1", "Speaker 2"… in order of first speaking, here and where their names are said. */
  pseudonyms: boolean;
  /** Mask email addresses, phone numbers and web addresses. */
  contacts: boolean;
  /** Words or names to mask wherever they appear (whole words, any capitalisation). */
  terms: string[];
}

export interface SafeCounts {
  names: number;
  emails: number;
  phones: number;
  links: number;
  terms: number;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
// Groups of digits (brackets allowed) joined by one space, dot or hyphen each: "+212 6 12 34 56 78",
// "(020) 7946-0958". A range like "2019 - 2024" or "10.30 - 11.45" breaks at " - ", so it never joins up.
const PHONE = /(?<![\p{L}\p{N}])\+?[\d(][\d()]*(?:[ .-][\d()]+)*(?![\p{L}\p{N}])/gu;
/** "12.05.2024", "2024-05-12": a date, not a number to call. */
const DATE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A word or name, on word boundaries that work for any script. */
const word = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "giu");

export function makeSafe(lines: Line[], opts: SafeOptions): { lines: Line[]; counts: SafeCounts; speakers: Array<[string, string]> } {
  const counts: SafeCounts = { names: 0, emails: 0, phones: 0, links: 0, terms: 0 };
  const speakers = new Map<string, string>();
  if (opts.pseudonyms) for (const l of lines) if (l.speaker && !speakers.has(l.speaker)) speakers.set(l.speaker, `Speaker ${speakers.size + 1}`);
  // A name said aloud is masked too: the whole name, and its first word when that is long enough to be a name.
  const said = [...speakers].flatMap(([name, alias]) => {
    const first = name.split(/\s+/)[0] ?? "";
    return [[name, alias] as const, ...(first.length >= 3 && first !== name ? [[first, alias] as const] : [])];
  });
  const terms = [...new Set(opts.terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  const count = (text: string, re: RegExp, to: string, key: keyof SafeCounts) =>
    text.replace(re, () => {
      counts[key]++;
      return to;
    });
  const out = lines.map((l) => {
    let text = l.text;
    if (opts.contacts) {
      text = count(text, EMAIL, "[email]", "emails");
      text = count(text, LINK, "[link]", "links");
      // Only with 8 digits or more: "2019 - 2024" or "10.30 - 11.45" are not phone numbers.
      text = text.replace(PHONE, (m) => ((m.match(/\d/g) ?? []).length >= 8 && !DATE.test(m) ? (counts.phones++, "[phone]") : m));
    }
    for (const term of terms) text = count(text, word(term), "[removed]", "terms");
    for (const [name, alias] of said) text = count(text, word(name), alias, "names");
    return { ...l, speaker: speakers.get(l.speaker) ?? l.speaker, text };
  });
  return { lines: out, counts, speakers: [...speakers] };
}

/** The safe copy as a file in one of the transcript formats. */
export function safeFile(lines: Line[], format: SafeFormat, title: string): { fileName: string; contentType: string; body: string | Uint8Array } {
  const name = `Transcript (share-safe).${format}`;
  if (format === "txt") return { fileName: name, contentType: "text/plain; charset=utf-8", body: toTxt(lines) };
  if (format === "srt") return { fileName: name, contentType: "application/x-subrip; charset=utf-8", body: toSrt(lines) };
  if (format === "vtt") return { fileName: name, contentType: "text/vtt; charset=utf-8", body: toVtt(lines) };
  return { fileName: name, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: toDocx(lines, { title, subtitle: "Names and contact details removed" }) };
}
