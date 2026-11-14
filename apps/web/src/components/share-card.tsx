"use client";

// A recording's share page: a public page with its player (and its transcript, if you say so)
// for anyone who has the link, and the code to embed the player on a site. Off until turned on.
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import type { ShareSettings } from "@/server/share";

export function ShareCard({ studioId, recordingId, initial, hasTranscript, video }: { studioId: string; recordingId: string; initial: ShareSettings; hasTranscript: boolean; video: boolean }) {
  const [share, setShare] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = share.code ? `${origin}/share/${share.code}` : "";
  const embed = share.code ? `<iframe src="${origin}/embed/${share.code}" ${video ? 'width="640" height="376"' : 'width="480" height="72"'} style="border:0" allow="fullscreen" title="Recording"></iframe>` : "";

  async function save(body: { enabled: boolean; transcript: boolean; newLink?: boolean }) {
    setBusy(true);
    setProblem(null);
    try {
      setShare(await apiFetch<ShareSettings>(`/studios/${studioId}/recordings/${recordingId}/share`, { method: "PUT", body }));
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const copy = (what: string, text: string) => void navigator.clipboard.writeText(text).then(() => (setCopied(what), setTimeout(() => setCopied(null), 1800)));
  const small = "cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text transition-colors hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] pt-1 pb-3.5" data-testid="share" data-shared={share.code ? "yes" : "no"}>
      <span className="pt-3 pb-2 font-medium">Share page</span>
      <span className="border-t border-divider pt-3 text-[14.5px] leading-normal text-pretty text-muted">
        {share.code
          ? "Anyone with this link can play this recording. It isn't listed anywhere and search engines are asked not to index it."
          : "A public page with this recording's player, for anyone you send the link to. Nobody can see it until you turn it on."}
      </span>
      {share.code ? (
        <>
          <span className="flex flex-wrap items-center gap-2 pt-3">
            <input readOnly value={link} aria-label="Share link" onFocus={(e) => e.target.select()} className="h-[32px] min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[14px] text-text-2" />
            <button type="button" className={small} onClick={() => copy("link", link)}>
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
            <button type="button" className={small} onClick={() => copy("embed", embed)}>
              {copied === "embed" ? "Copied" : "Copy embed code"}
            </button>
          </span>
          {hasTranscript && (
            <label className="flex cursor-pointer items-start gap-2.5 pt-3 text-[14.5px] leading-snug">
              <input type="checkbox" checked={share.transcript} disabled={busy} onChange={(e) => void save({ enabled: true, transcript: e.target.checked })} className="mt-0.5 size-4 shrink-0" />
              <span>Show the transcript on the page too</span>
            </label>
          )}
          <span className="flex flex-wrap gap-[5px] pt-3">
            <button type="button" disabled={busy} className={small} onClick={() => confirm("Make a new link? The old one stops working everywhere it was sent or embedded.") && void save({ enabled: true, transcript: share.transcript, newLink: true })}>
              New link
            </button>
            <button type="button" disabled={busy} className={small} onClick={() => void save({ enabled: false, transcript: false })}>
              Stop sharing
            </button>
          </span>
        </>
      ) : (
        <span className="pt-3">
          <button type="button" disabled={busy} className={small} onClick={() => void save({ enabled: true, transcript: false })}>
            Share this recording
          </button>
        </span>
      )}
      {problem && (
        <span role="alert" className="pt-2 text-[14px] text-danger">
          {problem}
        </span>
      )}
    </div>
  );
}
