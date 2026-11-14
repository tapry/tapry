"use client";

// Settings → Members: the people in this account. The owner invites by email (the link is
// shown too, to pass on by hand), withdraws invitations and removes members; a member can leave.
import type { MembersView } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Avatar, Button, Input, Notice } from "./ui";
import { ListCard } from "./ui-extra";

const failure = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");

export function MembersPanel({ initial }: { initial: MembersView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = async () => {
    setView(await apiFetch<MembersView>("/members"));
    router.refresh();
  };
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(null);
    }
  };

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    const role = data.get("role") === "viewer" ? "viewer" : "member";
    setSent(null);
    setCopied(false);
    await act("invite", async () => {
      const res = await apiFetch<{ link: string; emailed: boolean }>("/members/invites", { body: { email, role } });
      setSent({ email, ...res });
      form.reset();
    });
  }

  const taken = view.members.length + view.invites.length;
  const full = view.seats !== null && taken >= view.seats;

  return (
    <>
      <ListCard data-testid="members-panel">
        <span className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border pt-3 pb-2 text-[14px] text-muted">
          <span>Everyone here sees this account&apos;s studios and recordings and can host sessions. The plan, the storage and this list are the owner&apos;s.</span>
          <span data-testid="members-seats">{view.seats === null ? `${view.members.length} ${view.members.length === 1 ? "person" : "people"}` : `${taken} of ${view.seats} seats`}</span>
        </span>
        {view.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-divider py-3 last:border-0" data-testid="member">
            <span className="flex min-w-0 flex-[1_1_220px] items-center gap-3">
              <Avatar name={m.name} src={m.avatarUrl} className="size-8 text-[12px]" />
              <span className="flex min-w-0 flex-col gap-[2px]">
                <span className="truncate font-medium">
                  {m.name}
                  {m.you && <span className="font-normal text-muted"> · you</span>}
                </span>
                <span className="truncate text-[14px] text-muted">{m.email}</span>
              </span>
            </span>
            <span className="flex items-center gap-3">
              {view.owner && m.role !== "owner" ? (
                <select
                  aria-label={`What ${m.name} may do`}
                  value={m.role}
                  disabled={busy !== null}
                  onChange={(e) => act(`role:${m.id}`, () => apiFetch(`/members/${m.id}`, { method: "PUT", body: { role: e.target.value } }))}
                  className="h-[30px] rounded-md border border-border bg-surface px-2 text-[14px] text-text"
                  data-testid="member-role"
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="text-[14px] text-text-2">{m.role === "owner" ? "Owner" : m.role === "viewer" ? "Viewer" : "Member"}</span>
              )}
              {m.role !== "owner" && (view.owner || m.you) && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    act(`remove:${m.id}`, async () => {
                      await apiFetch(`/members/${m.id}`, { method: "DELETE" });
                      // Someone who left is signed out: back to the log-in page.
                      if (m.you) window.location.replace("/login");
                    })
                  }
                >
                  {m.you ? "Leave" : "Remove"}
                </Button>
              )}
            </span>
          </div>
        ))}
        {view.invites.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-divider py-3 last:border-0" data-testid="member-invite">
            <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[2px]">
              <span className="truncate font-medium">{i.email}</span>
              <span className="text-[14px] text-muted">Invited as a {i.role} · the link works until {new Date(i.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
            </span>
            <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => act(`revoke:${i.id}`, () => apiFetch(`/members/invites/${i.id}`, { method: "DELETE" }))}>
              Withdraw
            </Button>
          </div>
        ))}
      </ListCard>

      {view.owner && (
        <ListCard className="pb-4">
          <span className="border-b border-border pt-3 pb-2 text-[14px] text-muted">Invite someone. They get a link to create their own log-in for this account.</span>
          {full ? (
            <p className="pt-4 text-sm text-text-2" data-testid="members-full">
              {view.seats === 1 ? "Your plan is for one person." : `All ${view.seats} seats of your plan are taken.`} A bigger plan (the Plan tab) has seats for more.
            </p>
          ) : (
            <form onSubmit={invite} className="flex flex-wrap items-end gap-2 pt-4">
              <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 text-sm font-medium">
                Email
                <Input name="email" type="email" required autoComplete="off" placeholder="colleague@example.com" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Can
                <select name="role" defaultValue="member" className="h-[38px] rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs">
                  <option value="member">Record and manage (member)</option>
                  <option value="viewer">Look, download and comment (viewer)</option>
                </select>
              </label>
              <Button type="submit" disabled={busy !== null}>
                {busy === "invite" ? "Inviting…" : "Invite"}
              </Button>
            </form>
          )}
          {sent && (
            <Notice tone="ok" className="mt-3 flex flex-col gap-2" data-testid="invite-sent">
              <span>{sent.emailed ? `An invitation is on its way to ${sent.email}.` : `Send ${sent.email} this link. This server doesn't send email, so it's yours to pass on.`}</span>
              <span className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1 font-mono text-[13px] text-text-2" data-testid="invite-link">
                  {sent.link}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(sent.link).then(() => setCopied(true));
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </span>
            </Notice>
          )}
        </ListCard>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </>
  );
}
