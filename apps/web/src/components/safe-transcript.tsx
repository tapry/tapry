"use client";

// A share-safe copy of a recording's transcript: speakers get neutral names, and email
// addresses, phone numbers, links and the words you list are masked. Made when you ask and
// downloaded straight away; the recording's own transcript, sound and picture are untouched.
import { useState } from "react";
import { ApiRequestError } from "@/lib/client/api";

interface Counts {
  names: number;
  emails: number;
  phones: number;
  links: number;
  terms: number;
}

const FORMATS = [
  ["txt", "TXT"],
  ["docx", "DOCX"],
  ["srt", "SRT"],
  ["vtt", "VTT"],
] as const;

export function SafeTranscript({ recordingId }: { recordingId: string }) {
  const [pseudonyms, setPseudonyms] = useState(true);
  const [contacts, setContacts] = useState(true);
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ counts: Counts; speakers: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const body = (extra: object) =>
    JSON.stringify({ format: "txt", pseudonyms, contacts, terms: terms.split(/[\n,]/).map((t) => t.trim()).filter(Boolean).slice(0, 100), ...extra });
  async function ask(extra: object) {
    const res = await fetch(`/api/recordings/${recordingId}/transcript/safe`, { method: "POST", headers: { "content-type": "application/json" }, body: body(extra) });
    if (!res.ok) {
      const failed = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ApiRequestError(res.status, failed.error ?? "failed", failed.message ?? "Something went wrong. Try again.");
    }
    return res;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const check = () => run(async () => setFound(await (await ask({ preview: true })).json()));
  const download = (format: string) =>
    run(async () => {
      const blob = await (await ask({ format })).blob();
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: `Transcript (share-safe).${format}` }).click();
      URL.revokeObjectURL(url);
    });

  const total = found ? Object.values(found.counts).reduce((n, c) => n + c, 0) : 0;
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] pt-1 pb-3.5" data-testid="safe-transcript">
      <span className="pt-3 pb-2 font-medium">Share-safe transcript</span>
      <span className="border-t border-divider pt-3 text-[13.5px] leading-normal text-pretty text-muted">
        A copy of the transcript for passing on: made when you ask, never stored. Only the text changes. The sound and picture still say what was said, and a transcript can miss or mishear a
        name, so read it before you share it.
      </span>
      <label className="flex cursor-pointer items-start gap-2.5 pt-3 text-[13.5px] leading-snug">
        <input type="checkbox" checked={pseudonyms} onChange={(e) => (setPseudonyms(e.target.checked), setFound(null))} className="mt-0.5 size-4 shrink-0" />
        <span>Replace speakers&apos; names with Speaker 1, Speaker 2…, also where their names are said</span>
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 pt-2 text-[13.5px] leading-snug">
        <input type="checkbox" checked={contacts} onChange={(e) => (setContacts(e.target.checked), setFound(null))} className="mt-0.5 size-4 shrink-0" />
        <span>Mask email addresses, phone numbers and web addresses</span>
      </label>
      <label className="flex flex-col gap-1 pt-3 text-[12.5px] text-muted">
        Other words or names to mask (one per line, or separated by commas)
        <textarea
          value={terms}
          onChange={(e) => (setTerms(e.target.value), setFound(null))}
          rows={2}
          placeholder="Acme, Casablanca"
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
        />
      </label>
      <span className="flex flex-wrap items-center gap-[5px] pt-3">
        <button type="button" disabled={busy} onClick={() => void check()} className="cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text transition-colors hover:bg-surface-2 disabled:opacity-50">
          Count what gets masked
        </button>
        {FORMATS.map(([format, name]) => (
          <button key={format} type="button" disabled={busy} onClick={() => void download(format)} className="cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text transition-colors hover:bg-surface-2 disabled:opacity-50">
            {name}
          </button>
        ))}
      </span>
      {found && (
        <span role="status" className="pt-2 text-[13px] text-text-2" data-testid="safe-counts">
          {total === 0 && found.speakers === 0
            ? "Nothing to mask was found."
            : [
                found.speakers > 0 && `${found.speakers} ${found.speakers === 1 ? "speaker" : "speakers"} renamed`,
                found.counts.names > 0 && `${found.counts.names} spoken ${found.counts.names === 1 ? "name" : "names"}`,
                found.counts.emails > 0 && `${found.counts.emails} email ${found.counts.emails === 1 ? "address" : "addresses"}`,
                found.counts.phones > 0 && `${found.counts.phones} phone ${found.counts.phones === 1 ? "number" : "numbers"}`,
                found.counts.links > 0 && `${found.counts.links} ${found.counts.links === 1 ? "link" : "links"}`,
                found.counts.terms > 0 && `${found.counts.terms} of your words`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      )}
      {problem && (
        <span role="alert" className="pt-2 text-[13px] text-danger">
          {problem}
        </span>
      )}
    </div>
  );
}
