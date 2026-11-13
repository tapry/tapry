// Settings → Plan, on Tapry Cloud only: the plan this account is on, what it has used of it
// this billing month, and where to change it. Every figure comes from BillingService.
import { PLANS, type BillingOverview, type Plan } from "@tapry/shared";
import type { ReactNode } from "react";
import { cn } from "./ui";
import { ListCard } from "./ui-extra";
import { PlanAccounts, type Account } from "./plan-accounts";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "1 h 30 min", "45 min", "0 min". */
export function hoursAndMinutes(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const price = (p: Plan) => (p.monthlyUsd === null ? "By agreement" : p.monthlyUsd === 0 ? "$0" :`$${p.monthlyUsd} a month`);
const keeps = (days: number | null) => (days === null ? "Until you delete them" : `${days} days after a recording is processed`);

export function PlanPanel({ billing, accounts }: { billing: BillingOverview; accounts: Account[] | null }) {
  const { plan } = billing;
  const included = plan.hours === null ? null : plan.hours * 3_600_000;
  const share = included === null ? 0 : Math.min(1, billing.usedMs / included);
  const usedUp = included !== null && billing.usedMs >= included;

  return (
    <>
      <ListCard data-testid="plan-panel">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-divider py-4">
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span className="text-[13px] text-muted">Your plan</span>
            <span className="text-lg font-medium" data-testid="plan-name">
              {plan.name}
            </span>
            <span className="text-[13px] text-muted">{price(plan)}</span>
          </span>
          {billing.manageUrl && (
            <a href={billing.manageUrl} className="font-medium text-text underline underline-offset-[3px] hover:text-accent-strong">
              Card, invoices and cancelling
            </a>
          )}
        </div>

        {billing.status === "past_due" && (
          <p className="border-b border-divider py-3 text-[13.5px] text-warn-strong" data-testid="plan-past-due">
            The last payment didn&apos;t go through. The plan stays on while the payment is tried again.
          </p>
        )}
        {billing.status === "canceled" && billing.endsAt && (
          <p className="border-b border-divider py-3 text-[13.5px] text-muted" data-testid="plan-ends">
            Canceled: this plan runs until {day(billing.endsAt)}, then the account is on {PLANS.free.name}.
          </p>
        )}
        {billing.status !== "canceled" && billing.endsAt && (
          <p className="border-b border-divider py-3 text-[13.5px] text-muted" data-testid="plan-ends">
            This plan runs until {day(billing.endsAt)}, then the account is on {PLANS.free.name}.
          </p>
        )}

        <div className="flex flex-col gap-2.5 border-b border-divider py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <span className="font-medium">Recording hours this month</span>
            <span className="text-text-2" data-testid="plan-usage">
              {included === null ? `${hoursAndMinutes(billing.usedMs)} recorded · no limit` : `${hoursAndMinutes(billing.usedMs)} of ${plan.hours} h`}
            </span>
          </div>
          {included !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Recording hours used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
              <div className={cn("h-full rounded-full", usedUp ? "bg-warn" : "bg-ink")} style={{ width: `${share * 100}%` }} />
            </div>
          )}
          <span className="text-[13px] leading-normal text-pretty text-muted">
            {usedUp
              ? `This month's hours are used up: Record is off until ${day(billing.periodEnd)}, or until you move to a bigger plan. A recording that is running is never stopped.`
              : `Counted per recording, not per person. They start again on ${day(billing.periodEnd)}.`}
          </span>
        </div>

        <Line label="Finished files are kept" value={keeps(plan.filesDays)} help="After that a recording is deleted. Download what you want to keep longer." />
        <Line label="Original uploads are kept" value={keeps(plan.originalsDays)} help="The pieces each person's device uploaded. Once they go, a recording can't be processed again." last />
      </ListCard>

      {billing.upgrades.length > 0 && (
        <ListCard>
          <span className="border-b border-border pt-3 pb-2 text-[13px] text-muted">Bigger plans. Paying happens on our payment provider&apos;s page; no card detail reaches Tapry.</span>
          {billing.upgrades.map(({ plan: p, url }, i) => (
            <div key={p.id} className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4", i < billing.upgrades.length - 1 && "border-b border-divider")}>
              <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
                <span className="font-medium">
                  {p.name} · {price(p)}
                </span>
                <span className="text-[13px] leading-normal text-muted">
                  {p.hours === null ? "No limit on hours" : `${p.hours} recording hours a month`}, files kept {p.filesDays === null ? "until you delete them" : `${p.filesDays} days`}
                </span>
              </span>
              <a
                href={url}
                data-testid={`upgrade-${p.id}`}
                className="inline-flex h-[34px] items-center rounded-md bg-ink px-3.5 text-sm font-medium text-ink-text shadow-xs transition-colors hover:bg-ink-hover"
              >
                Move to {p.name}
              </a>
            </div>
          ))}
        </ListCard>
      )}

      {accounts && <PlanAccounts accounts={accounts} />}
    </>
  );
}

function Line({ label, value, help, last }: { label: string; value: ReactNode; help: string; last?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4", !last && "border-b border-divider")}>
      <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
        <span className="font-medium">{label}</span>
        <span className="text-[13px] leading-normal text-pretty text-muted">{help}</span>
      </span>
      <span className="text-text-2">{value}</span>
    </div>
  );
}
