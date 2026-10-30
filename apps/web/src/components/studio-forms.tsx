"use client";

import type { SessionTicket, StudioSettings } from "@opentake/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError, saveTicket } from "@/lib/client/api";
import { Button, Field, Input, Notice, Select } from "./ui";

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");

export function CreateStudioForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const studio = await apiFetch<{ id: string }>("/studios", { body: { name: new FormData(e.currentTarget).get("name") } });
      router.push(`/studios/${studio.id}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Field label="New studio">
          <Input name="name" placeholder="e.g. The Weekly Interview" required maxLength={100} />
        </Field>
      </div>
      <Button type="submit" disabled={busy}>
        Create studio
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}

export function InviteLink({ studioId, inviteCode: initial }: { studioId: string; inviteCode: string }) {
  const [code, setCode] = useState(initial);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/join/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  async function rotate() {
    if (!confirm("Make a new link? The current link will stop working for anyone who hasn't joined yet.")) return;
    try {
      setCode((await apiFetch<{ inviteCode: string }>(`/studios/${studioId}/invite`, { body: {} })).inviteCode);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={link} aria-label="Guest invite link" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" onClick={copy} className="shrink-0">
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button variant="ghost" onClick={rotate} className="shrink-0">
          New link
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

export function StudioSettingsForm({ studioId, name, settings }: { studioId: string; name: string; settings: StudioSettings }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch(`/studios/${studioId}`, {
        method: "PATCH",
        body: {
          name: f.get("name"),
          settings: {
            videoQuality: f.get("videoQuality"),
            maxGuests: Number(f.get("maxGuests")),
            echoCancellation: f.get("echoCancellation") === "on",
          },
        },
      });
      setStatus({ tone: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setStatus({ tone: "danger", text: message(err) });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Studio name">
        <Input name="name" defaultValue={name} required maxLength={100} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Video quality">
          <Select name="videoQuality" defaultValue={settings.videoQuality}>
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
          </Select>
        </Field>
        <Field label="Guests (besides you)">
          <Select name="maxGuests" defaultValue={String(settings.maxGuests)}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="echoCancellation" defaultChecked={settings.echoCancellation} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium">Echo cancellation for guests on speakers</span>
          <span className="block text-muted">
            Guests who say they're on headphones always get it switched off, which sounds better.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary">
          Save settings
        </Button>
        {status && <span className={status.tone === "ok" ? "text-sm text-ok" : "text-sm text-danger"}>{status.text}</span>}
      </div>
    </form>
  );
}

export function OpenStudioButton({ studioId }: { studioId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const ticket = await apiFetch<SessionTicket>(`/studios/${studioId}/open`, { body: {} });
      saveTicket(ticket);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="record" onClick={open} disabled={busy}>
        Enter studio
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await apiFetch("/auth/logout", { body: {} }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
