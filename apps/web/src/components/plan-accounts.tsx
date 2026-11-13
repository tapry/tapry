"use client";

// Settings → Plan, for the admin of Tapry Cloud: every account and its plan, and putting one
// on a plan by hand (a founding member, an organisation that pays by invoice).
import { PLAN_IDS, PLANS, type PlanId, type PlanStatus } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Select } from "./ui";
import { ListCard } from "./ui-extra";

export interface Account {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  status: PlanStatus;
  endsAt: string | null;
  subscription: boolean;
}

export function PlanAccounts({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPlan = async (id: string, plan: PlanId) => {
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/admin/accounts/${id}/plan`, { method: "PUT", body: { plan } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ListCard data-testid="plan-accounts">
      <span className="border-b border-border pt-3 pb-2 text-[13px] text-muted">
        Accounts on this server. Set a plan by hand for someone who pays outside the payment provider; subscriptions are kept by the provider.
      </span>
      {error && (
        <p role="alert" className="border-b border-divider py-3 text-[13.5px] text-danger">
          {error}
        </p>
      )}
      {accounts.map((a, i) => (
        <div key={a.id} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 ${i < accounts.length - 1 ? "border-b border-divider" : ""}`} data-testid="plan-account">
          <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[2px]">
            <span className="truncate font-medium">{a.name}</span>
            <span className="truncate text-[13px] text-muted">{a.email}</span>
          </span>
          {a.subscription ? (
            <span className="text-text-2">
              {PLANS[a.plan].name} · subscription{a.status === "past_due" ? " · payment failed" : a.status === "canceled" ? " · canceled" : ""}
            </span>
          ) : (
            <span className="w-[160px] shrink-0">
              <Select aria-label={`Plan for ${a.name}`} value={a.plan} disabled={busy === a.id} onChange={(e) => void setPlan(a.id, e.target.value as PlanId)}>
                {PLAN_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PLANS[id].name}
                  </option>
                ))}
              </Select>
            </span>
          )}
        </div>
      ))}
    </ListCard>
  );
}
