"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, Card, Field, Input, Notice } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/auth/${mode}`, {
        body: Object.fromEntries(["email", "password", ...(mode === "signup" ? ["name"] : [])].map((k) => [k, form.get(k)])),
      });
      router.replace("/studios");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <Field label="Your name">
            <Input name="name" autoComplete="name" required maxLength={100} />
          </Field>
        )}
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint={mode === "signup" ? "At least 10 characters." : undefined}>
          <Input
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" disabled={busy} className="w-full">
          {mode === "signup" ? "Create account" : "Sign in"}
        </Button>
        <p className="text-center text-sm text-muted">
          {mode === "signup" ? (
            <>
              Already have an account? <Link className="underline" href="/login">Sign in</Link>
            </>
          ) : (
            <>
              New server? <Link className="underline" href="/signup">Create the admin account</Link>
            </>
          )}
        </p>
      </form>
    </Card>
  );
}
