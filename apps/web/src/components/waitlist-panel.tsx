"use client";

// Settings → Plan, for the admin of Tapry Cloud: who asked on the website to hear when paid
// plans open. Addresses can be copied (to write to them) and removed (when someone asks).
import { PLANS, type PlanId } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { ListCard } from "./ui-extra";

export interface WaitlistRow {
  email: string;
  plan: string | null;
  createdAt: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const planName = (plan: string | null) => (plan && plan in PLANS ? PLANS[plan as PlanId].name : "Any plan");

export function WaitlistPanel({ entries }: { entries: WaitlistRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const remove = async (email: string) => {
    setBusy(email);
    setError(null);
    try {
      await apiFetch("/admin/waitlist", { method: "DELETE", body: { email } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entries.map((e) => e.email).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copying isn't allowed in this browser.");
    }
  };

  return (
    <ListCard data-testid="waitlist">
      <span className="flex flex-wrap items-center justify-between gap-3 border-b border-border pt-3 pb-2 text-[14px] text-muted">
        <span>
          Waitlist for paid plans: {entries.length === 0 ? "nobody yet." : `${entries.length} ${entries.length === 1 ? "person" : "people"}.`}
        </span>
        {entries.length > 0 && (
          <button type="button" onClick={copy} className="cursor-pointer font-medium text-text underline underline-offset-[3px]" data-testid="waitlist-copy">
            {copied ? "Copied" : "Copy the addresses"}
          </button>
        )}
      </span>
      {error && (
        <p role="alert" className="border-b border-divider py-3 text-[14.5px] text-danger">
          {error}
        </p>
      )}
      {entries.map((e, i) => (
        <div key={e.email} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 ${i < entries.length - 1 ? "border-b border-divider" : ""}`} data-testid="waitlist-entry">
          <span className="min-w-0 flex-[1_1_220px] truncate font-medium">{e.email}</span>
          <span className="text-[14px] text-muted">
            {planName(e.plan)} · {day(e.createdAt)}
          </span>
          <button type="button" disabled={busy === e.email} onClick={() => remove(e.email)} className="cursor-pointer text-[14px] text-danger underline underline-offset-[3px] disabled:opacity-50">
            Remove
          </button>
        </div>
      ))}
    </ListCard>
  );
}
