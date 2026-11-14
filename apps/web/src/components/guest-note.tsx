"use client";

// What you keep about a guest: a contact address and notes, under the name they record with.
// Only the people of your account see it; guests never do.
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, cn } from "./ui";

export function GuestNote({ name, initial, canEdit }: { name: string; initial: { email: string; notes: string }; canEdit: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [email, setEmail] = useState(initial.email);
  const [notes, setNotes] = useState(initial.notes);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const has = !!(saved.email || saved.notes);
  const id = `guest-note-${name.replace(/[^a-z0-9]+/gi, "-")}`;

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      setSaved(await apiFetch<{ email: string; notes: string }>("/guests/note", { method: "PUT", body: { name, email: email.trim(), notes: notes.trim() } }));
      setOpen(false);
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col-span-full flex flex-col gap-2 sm:pl-10" data-testid="guest-note">
      {!open && (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px]">
          {saved.email && (
            <a href={`mailto:${saved.email}`} className="truncate text-text-2 underline underline-offset-2">
              {saved.email}
            </a>
          )}
          {saved.notes && <span className="min-w-0 whitespace-pre-line text-muted">{saved.notes}</span>}
          {canEdit && (
            <button type="button" aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)} className="cursor-pointer text-muted underline underline-offset-2 hover:text-text">
              {has ? "Edit" : "Add contact or notes"}
            </button>
          )}
        </span>
      )}
      {open && (
        <div id={id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
          <label className="flex flex-col gap-1 text-[13.5px] text-muted">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              placeholder="guest@example.com"
              className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13.5px] text-muted">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="How you know them, what to ask next time, whether a release form is signed…"
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
            />
          </label>
          <span className="flex flex-wrap items-center gap-2.5">
            <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEmail(saved.email);
                setNotes(saved.notes);
                setOpen(false);
                setProblem(null);
              }}
            >
              Cancel
            </Button>
            {problem && (
              <span role="alert" className={cn("text-[14px] text-danger")}>
                {problem}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
