"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Icon, Spinner } from "./ui-extra";
import { Button, Field, Input, Notice } from "./ui";

export function AuthForm({
  mode,
  firstAccount = false,
  setupRequired = false,
  canReset = false,
  openSignup = false,
  next = null,
}: {
  mode: "login" | "signup";
  firstAccount?: boolean;
  setupRequired?: boolean;
  /** The server sends email, so "Forgot your password?" leads somewhere. */
  canReset?: boolean;
  /** Anyone may create an account here (not only the first one). */
  openSignup?: boolean;
  /** Where to go afterwards instead of the studios: a path on this server, checked by the page. */
  next?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  const signup = mode === "signup";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/auth/${mode}`, {
        body: Object.fromEntries(
          ["email", "password", ...(signup ? ["name"] : []), ...(signup && firstAccount && setupRequired ? ["setupToken"] : [])].map((k) => [k, form.get(k)]),
        ),
      });
      // A full page load, not router.replace + refresh: those two race (the refresh re-renders
      // this page mid-navigation), and a lost navigation left the button on "One moment…".
      window.location.replace(next ?? "/studios");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[18px]">
      {signup && (
        <Field label="Your name">
          <Input name="name" autoComplete="name" required maxLength={100} />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <label htmlFor={passwordId} className="text-sm font-medium">
            Password
          </label>
          {!signup && canReset && (
            <Link href="/forgot" className="text-[13px] text-muted underline underline-offset-[3px] hover:text-accent-strong">
              Forgot it?
            </Link>
          )}
        </span>
        <span className="relative flex">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={signup ? "new-password" : "current-password"}
            placeholder={signup ? "At least 10 characters" : "Your password"}
            minLength={signup ? 10 : undefined}
            required
            className="pr-10"
          />
          {/* Not "Show password": the form's tests find the field by the word Password. */}
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide what you typed" : "Show what you typed"}
            aria-pressed={showPassword}
            className="absolute top-1 right-1 grid size-[30px] cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} />
          </button>
        </span>
        {signup && <span className="text-[13px] text-muted">At least 10 characters.</span>}
      </div>
      {signup && firstAccount && setupRequired && (
        <Field label="Setup code" hint="SETUP_TOKEN in the server's .env file: only whoever installed it can take charge.">
          <Input name="setupToken" autoComplete="off" required maxLength={200} className="font-mono" />
        </Field>
      )}
      {signup && firstAccount && (
        <Notice tone="warn" className="flex items-start gap-2.5">
          <Icon name="shield" size={16} className="mt-0.5" />
          <span>You&apos;re the first person on this server, so your account will be in charge. You can create studios and invite guests.</span>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={busy} className={busy ? "w-full disabled:opacity-70" : "w-full"}>
        {busy && <Spinner />}
        {busy ? "One moment…" : signup ? "Create account" : "Log in"}
      </Button>
      {!signup && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13.5px] text-text-2">
          <Icon name="link" />
          Got a guest link? Open it to join. Guests never need an account.
        </div>
      )}
      <p className="text-center text-sm text-muted">
        {signup ? (
          <>
            Already have an account?{" "}
            <Link className="font-medium text-text underline underline-offset-[3px] hover:text-accent-strong" href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
              Log in
            </Link>
          </>
        ) : (
          <>
            {openSignup ? "New here?" : "New server?"}{" "}
            <Link className="font-medium text-text underline underline-offset-[3px] hover:text-accent-strong" href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>
              {openSignup ? "Create an account" : "Create the first account"}
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
