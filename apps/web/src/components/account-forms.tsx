"use client";

// The forms behind the emailed links: asking for a new password, setting it, confirming an address.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, Field, Input, Notice } from "./ui";
import { Spinner } from "./ui-extra";

const link = "font-medium text-text underline underline-offset-[3px] hover:text-accent-strong";
const failure = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");

/** "I forgot my password": says the same whether or not the address has an account. */
export function ForgotForm() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await apiFetch("/auth/forgot", { body: { email: new FormData(e.currentTarget).get("email") } });
      setState("done");
    } catch (err) {
      setError(failure(err));
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <>
        <Notice tone="ok" data-testid="forgot-sent">
          If an account has that address, a link to set a new password is on its way. It works for one hour.
        </Notice>
        <p className="text-center text-sm text-muted">
          <Link className={link} href="/login">
            Back to log in
          </Link>
        </p>
      </>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-[18px]">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={state === "busy"} className="w-full">
        {state === "busy" && <Spinner />}
        {state === "busy" ? "One moment…" : "Email me a link"}
      </Button>
      <p className="text-center text-sm text-muted">
        <Link className={link} href="/login">
          Back to log in
        </Link>
      </p>
    </form>
  );
}

/** Set a new password with the link's token. */
export function ResetForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await apiFetch("/auth/reset", { body: { token, password: new FormData(e.currentTarget).get("password") } });
      setState("done");
    } catch (err) {
      setError(failure(err));
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <>
        <Notice tone="ok" data-testid="reset-done">
          Your password is changed, and every device was signed out.
        </Notice>
        <Link href="/login" className="inline-flex h-[38px] w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-ink-text transition-colors hover:bg-ink-hover">
          Log in
        </Link>
      </>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-[18px]">
      <Field label="New password" hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
      </Field>
      {error && (
        <Notice tone="danger">
          {error}{" "}
          <Link className="underline underline-offset-[3px]" href="/forgot">
            Ask for a new link
          </Link>
        </Notice>
      )}
      <Button type="submit" disabled={state === "busy"} className="w-full">
        {state === "busy" && <Spinner />}
        {state === "busy" ? "One moment…" : "Set new password"}
      </Button>
    </form>
  );
}

/** Confirm the address. A button, not the page load: mail scanners open links, and shouldn't confirm for anyone. */
export function VerifyForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setState("busy");
    setError(null);
    try {
      await apiFetch("/auth/verify", { body: { token } });
      setState("done");
    } catch (err) {
      setError(failure(err));
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <>
        <Notice tone="ok" data-testid="verify-done">
          Your email is confirmed.
        </Notice>
        <Link href="/studios" className="inline-flex h-[38px] w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-ink-text transition-colors hover:bg-ink-hover">
          Go to your studios
        </Link>
      </>
    );
  }
  return (
    <>
      {error && <Notice tone="danger">{error} Log in and ask for a new link from the top of the page.</Notice>}
      <Button type="button" disabled={state === "busy"} onClick={confirm} className="w-full">
        {state === "busy" && <Spinner />}
        {state === "busy" ? "One moment…" : "Confirm my email"}
      </Button>
    </>
  );
}
