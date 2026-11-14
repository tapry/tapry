"use client";

// Settings → Account, for the account's owner: API keys (the app's API for your own scripts)
// and webhooks (a signed message to your server when a recording is ready). A new key or
// secret is shown once, here, when it is made.
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import type { ApiKeyView, WebhookView } from "@/server/integrations";
import { Button, Input } from "./ui";
import { ListCard } from "./ui-extra";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function IntegrationsPanel({ keys: initialKeys, webhooks: initialHooks }: { keys: ApiKeyView[]; webhooks: WebhookView[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [hooks, setHooks] = useState(initialHooks);
  const [shown, setShown] = useState<{ what: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const reload = async () => {
    setKeys((await apiFetch<{ keys: ApiKeyView[] }>("/keys")).keys);
    setHooks((await apiFetch<{ webhooks: WebhookView[] }>("/webhooks")).webhooks);
  };
  function addKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    void run(async () => {
      const made = await apiFetch<{ key: string }>("/keys", { body: { name: String(new FormData(form).get("name") ?? "") } });
      setShown({ what: "API key", value: made.key });
      form.reset();
      await reload();
    });
  }
  function addHook(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    void run(async () => {
      const made = await apiFetch<{ secret: string }>("/webhooks", { body: { url: String(new FormData(form).get("url") ?? "") } });
      setShown({ what: "webhook signing secret", value: made.secret });
      form.reset();
      await reload();
    });
  }
  const remove = (path: string) => run(async () => (await apiFetch(path, { method: "DELETE" }), await reload()));

  return (
    <ListCard data-testid="integrations">
      <span className="border-b border-border pt-3 pb-2 text-[14px] text-muted">
        For your own scripts and tools. A key reads what your members can read and can change studios and recordings; it can&apos;t touch the plan, members, storage or other keys. How to use it:
        docs/api.md in the repository.
      </span>
      {shown && (
        <div className="flex flex-col gap-1.5 border-b border-divider py-3" data-testid="integration-secret">
          <span className="text-[14.5px] font-medium">Your new {shown.what}. Copy it now: it is not shown again.</span>
          <input readOnly value={shown.value} onFocus={(e) => e.target.select()} className="h-[34px] rounded-md border border-border bg-surface-2 px-2.5 font-mono text-[13.5px] text-text" />
        </div>
      )}

      <div className="flex flex-col gap-2 border-b border-divider py-3">
        <span className="font-medium">API keys</span>
        {keys.length === 0 && <span className="text-[14px] text-muted">No keys yet.</span>}
        {keys.map((k) => (
          <span key={k.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[14.5px]" data-testid="api-key">
            <span className="min-w-0">
              <span className="font-medium">{k.name}</span> <span className="font-mono text-[13.5px] text-muted">{k.prefix}</span>
              <span className="text-muted"> · made {day(k.createdAt)}{k.lastUsedAt ? ` · last used ${day(k.lastUsedAt)}` : " · never used"}</span>
            </span>
            <button type="button" disabled={busy} onClick={() => confirm(`Revoke "${k.name}"? Anything using it stops working.`) && void remove(`/keys/${k.id}`)} className="cursor-pointer text-[13.5px] text-danger underline underline-offset-[3px]">
              Revoke
            </button>
          </span>
        ))}
        <form onSubmit={addKey} className="flex flex-wrap items-end gap-2 pt-1">
          <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-[13.5px] text-muted">
            What it is for
            <Input name="name" required maxLength={60} placeholder="Editing script" />
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            Make a key
          </Button>
        </form>
      </div>

      <div className="flex flex-col gap-2 py-3">
        <span className="font-medium">Webhooks</span>
        <span className="text-[14px] leading-normal text-pretty text-muted">
          When a recording&apos;s files are ready, and again when its transcript is, a signed message goes to each address: the recording&apos;s names, times and file list, never media or what was
          said.
        </span>
        {hooks.map((h) => (
          <span key={h.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[14.5px]" data-testid="webhook">
            <span className="min-w-0 truncate">
              {h.url}
              {h.failing && <span className="text-warn-strong"> · the last message couldn&apos;t be delivered</span>}
            </span>
            <button type="button" disabled={busy} onClick={() => void remove(`/webhooks/${h.id}`)} className="cursor-pointer text-[13.5px] text-danger underline underline-offset-[3px]">
              Remove
            </button>
          </span>
        ))}
        <form onSubmit={addHook} className="flex flex-wrap items-end gap-2 pt-1">
          <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-1 text-[13.5px] text-muted">
            Address (https)
            <Input name="url" type="url" required maxLength={500} placeholder="https://example.com/hooks/tapry" />
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            Add a webhook
          </Button>
        </form>
      </div>
      {problem && (
        <span role="alert" className="pb-3 text-[14px] text-danger">
          {problem}
        </span>
      )}
    </ListCard>
  );
}
