"use client";

// Settings → Plan, on Tapry Cloud: education accounts. Teachers, students and researchers at
// a school or university get more free recording hours and a discount on paid plans. An
// address on an academic domain is recognised by itself once confirmed; otherwise the request
// is looked at by hand.
import type { EducationStatus } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import type { EducationRequest } from "@/server/education";
import { Button, cn } from "./ui";
import { ListCard } from "./ui-extra";

export function EducationCard({ initial }: { initial: EducationStatus }) {
  const router = useRouter();
  const [edu, setEdu] = useState(initial);
  const [school, setSchool] = useState(initial.school);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setProblem(null);
    try {
      setEdu(await apiFetch<EducationStatus>("/billing/education", { body: { school: school.trim() } }));
      router.refresh(); // the hours above change with it
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const gives = `${edu.freeHours} recording hours a month on the Free plan, and ${edu.discountPercent}% off Creator, Studio and Team${edu.discountActive ? "" : " once paid plans open"}.`;
  return (
    <ListCard data-testid="education-card" data-status={edu.status}>
      <div className="flex flex-col gap-3 py-4">
        <span className="flex flex-col gap-[3px]">
          <span className="font-medium">Education</span>
          <span className="text-[14px] leading-normal text-pretty text-muted">
            {edu.status === "verified"
              ? `This is an education account${edu.school ? ` (${edu.school})` : ""}: ${gives}`
              : edu.status === "requested"
                ? `Your request${edu.school ? ` for ${edu.school}` : ""} is waiting to be looked at. Once it's approved: ${gives}`
                : `For teachers, students and researchers at a school or university: ${gives}`}
          </span>
        </span>
        {edu.status === "none" &&
          (edu.owner ? (
            <div className="flex flex-wrap items-end gap-2.5">
              <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1 text-[13.5px] text-muted">
                Your school or university
                <input
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Mohammed V University"
                  className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
                />
              </label>
              <Button type="button" variant="secondary" disabled={busy || school.trim().length === 0} onClick={() => void ask()}>
                {edu.automatic ? "Make this an education account" : "Ask for an education account"}
              </Button>
            </div>
          ) : (
            <span className="text-[14px] text-muted">The account&apos;s owner can ask for this.</span>
          ))}
        {edu.status === "none" && edu.owner && (
          <span className="text-[13.5px] leading-normal text-muted">
            {edu.automatic
              ? "Your email address is at a school or university, so this takes effect at once."
              : "We look at each request by hand, usually within a few working days. An address at your school (.edu, .ac.uk and the like), once confirmed, is recognised by itself."}
          </span>
        )}
        {problem && (
          <span role="alert" className={cn("text-[14px] text-danger")}>
            {problem}
          </span>
        )}
      </div>
    </ListCard>
  );
}

/** For the admin: education requests waiting, to approve or decline. */
export function EducationRequests({ initial }: { initial: EducationRequest[] }) {
  const [requests, setRequests] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  if (requests.length === 0) return null;

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      await apiFetch(`/admin/education/${id}`, { body: { approve } });
      setRequests((now) => now.filter((r) => r.id !== id));
    } catch {
      // Left in the list: the admin sees it didn't go and tries again.
    } finally {
      setBusy(null);
    }
  }

  return (
    <ListCard data-testid="education-requests">
      <span className="border-b border-border pt-3 pb-2 text-[14px] text-muted">Education requests waiting. Approve where the school is real and the person belongs to it.</span>
      {requests.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-divider py-3 last:border-0" data-testid="education-request">
          <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-[2px]">
            <span className="truncate font-medium">{r.school || "No school given"}</span>
            <span className="truncate text-[14px] text-muted">
              {r.name} · {r.email}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void decide(r.id, false)}>
              Decline
            </Button>
            <Button type="button" size="sm" disabled={busy === r.id} onClick={() => void decide(r.id, true)}>
              Approve
            </Button>
          </span>
        </div>
      ))}
    </ListCard>
  );
}
