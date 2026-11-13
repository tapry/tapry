"use client";

// The invitation page's form: someone new chooses a name and password for the invited address;
// someone already signed in with that address joins with one press.
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, Field, Input, Notice } from "./ui";
import { Spinner } from "./ui-extra";

export function InviteForm({ token, email, signedIn }: { token: string; email: string; signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/invites/${token}`, { body });
      // A full page load: the new session cookie must reach every part of the page.
      window.location.replace("/studios");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  if (signedIn) {
    return (
      <>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="button" disabled={busy} onClick={() => accept({})} className="w-full">
          {busy && <Spinner />}
          {busy ? "One moment…" : "Join the account"}
        </Button>
      </>
    );
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void accept({ name: form.get("name"), password: form.get("password") });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-[18px]">
      <Field label="Email">
        <Input value={email} readOnly disabled />
      </Field>
      <Field label="Your name">
        <Input name="name" autoComplete="name" required maxLength={100} />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy && <Spinner />}
        {busy ? "One moment…" : "Create my log-in and join"}
      </Button>
    </form>
  );
}
