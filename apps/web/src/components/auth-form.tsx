"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, Field, Input, Notice } from "./ui";

export function AuthForm({ mode, firstAccount = false }: { mode: "login" | "signup"; firstAccount?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/auth/${mode}`, {
        body: Object.fromEntries(["email", "password", ...(signup ? ["name"] : [])].map((k) => [k, form.get(k)])),
      });
      router.replace("/shows");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {signup && (
        <Field label="Your name">
          <Input name="name" autoComplete="name" required maxLength={100} />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" hint={signup ? "At least 10 characters." : undefined}>
        <Input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          minLength={signup ? 10 : undefined}
          required
        />
      </Field>
      {signup && firstAccount && (
        <Notice tone="warn" className="flex items-start gap-3">
          <span aria-hidden>★</span>
          <span>You're the first person on this server, so your account will be in charge. You can create shows and invite guests.</span>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" variant="record" size="lg" disabled={busy} className="mt-1.5 w-full text-[17px]">
        {signup ? "Create account" : "Log in"}
      </Button>
      <p className="text-center text-[15px] text-muted">
        {signup ? (
          <>
            Already have an account?{" "}
            <Link className="font-semibold text-accent-strong" href="/login">
              Log in
            </Link>
          </>
        ) : (
          <>
            New server?{" "}
            <Link className="font-semibold text-accent-strong" href="/signup">
              Create the first account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
