"use client";

// The Tapry Cloud waitlist: a button that opens an email field in place, posting the email to
// NEXT_PUBLIC_WAITLIST_URL (a form service). Unset, it points to GitHub releases instead.
import { useState, type CSSProperties, type FormEvent } from "react";
import { RELEASES_URL, WAITLIST_URL } from "@/content/site";

export function WaitlistButton({ dark, label = "Join the waitlist" }: { dark: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "joined" | "error">("idle");
  const btn: CSSProperties = {
    display: "inline-flex",
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    transition: "background .2s",
    border: `1px solid ${dark ? "#0b0b0f" : "#e6e6e9"}`,
    background: dark ? "#0b0b0f" : "#fff",
    color: dark ? "#fff" : "#0b0b0f",
    cursor: "pointer",
    padding: "0 14px",
    whiteSpace: "nowrap",
  };

  if (!WAITLIST_URL) {
    return (
      <a href={RELEASES_URL} className="hv-85" style={btn}>
        Watch releases on GitHub
      </a>
    );
  }
  if (!open) {
    return (
      <button type="button" className="hv-85" style={btn} onClick={() => setOpen(true)} aria-expanded={false}>
        {label}
      </button>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch(WAITLIST_URL!, { method: "POST", body: new FormData(e.currentTarget), headers: { accept: "application/json" } });
      setState(res.ok ? "joined" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="email"
          name="email"
          required
          autoFocus
          placeholder="you@example.com"
          aria-label="Email for the Tapry Cloud waitlist"
          disabled={state === "joined"}
          style={{ flex: 1, minWidth: 0, height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid #e6e6e9", background: "#fff", color: "#0b0b0f", fontSize: 14 }}
        />
        <button type="submit" disabled={state === "sending" || state === "joined"} style={{ ...btn, background: "#0b0b0f", color: "#fff", border: "1px solid #0b0b0f" }}>
          {state === "joined" ? "✓ On the list" : state === "sending" ? "Joining…" : "Join"}
        </button>
      </div>
      <span role="status" style={{ fontSize: 13, color: state === "error" ? "#c43c25" : "#6b6b70" }}>
        {state === "error" ? "That didn’t go through. Try again in a moment." : state === "joined" ? "You’re on the list. You’ll get one email when it opens." : "One email, when Tapry Cloud opens."}
      </span>
    </form>
  );
}
