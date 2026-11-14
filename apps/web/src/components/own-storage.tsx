"use client";

// Storage page → "Your own storage": connect an S3-compatible bucket so this account's
// recordings go there. Saving proves the server can use the bucket; then this browser tries an
// upload exactly like a guest's, because only the bucket's CORS rules allow those.
import type { OwnStorageView } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, CheckboxRow, Field, Input, Notice } from "./ui";
import { ListCard, Spinner } from "./ui-extra";

type Check = { url: string; headers: Record<string, string>; key: string; body: string };

const failure = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");

/** Try an upload from this browser, then have the server look for it. */
async function browserCheck(): Promise<OwnStorageView> {
  const check = await apiFetch<Check>("/storage/own/check", { body: {} });
  let res: Response;
  try {
    res = await fetch(check.url, { method: "PUT", headers: check.headers, body: check.body });
  } catch {
    // A browser reports a CORS refusal as a network error, without saying more.
    throw new Error("cors");
  }
  if (!res.ok) throw new Error(`status ${res.status}`);
  return apiFetch<OwnStorageView>("/storage/own/check/confirm", { body: { key: check.key } });
}

export function OwnStorage({ initial }: { initial: OwnStorageView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState(!initial.target);
  const [busy, setBusy] = useState<"save" | "check" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const started = useRef(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const check = async () => {
    setBusy("check");
    setError(null);
    setBlocked(null);
    try {
      setView(await browserCheck());
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setBlocked(err instanceof Error && err.message.startsWith("status") ? `The bucket answered with ${err.message}.` : "The browser wasn't allowed to upload to the bucket.");
    } finally {
      setBusy(null);
    }
  };

  // A bucket saved earlier but never proven: try once when the page opens.
  useEffect(() => {
    if (started.current || !initial.target || initial.target.verified) return;
    started.current = true;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("save");
    setError(null);
    setBlocked(null);
    try {
      const saved = await apiFetch<OwnStorageView>("/storage/own", {
        method: "PUT",
        body: {
          endpoint: String(form.get("endpoint") ?? ""),
          region: form.get("region"),
          bucket: form.get("bucket"),
          accessKeyId: form.get("accessKeyId"),
          secretAccessKey: form.get("secretAccessKey"),
          forcePathStyle: form.get("forcePathStyle") === "on",
        },
      });
      setView(saved);
      setEditing(false);
      setBusy(null);
      await check();
    } catch (err) {
      setError(failure(err));
      setBusy(null);
    }
  }

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      setView(await apiFetch<OwnStorageView>("/storage/own", { method: "DELETE" }));
      setEditing(true);
      setBlocked(null);
      router.refresh();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(null);
    }
  };

  const t = view.target;
  const cors = JSON.stringify([{ AllowedOrigins: [origin || "https://your-tapry-address"], AllowedMethods: ["PUT"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3000 }], null, 2);

  return (
    <ListCard data-testid="own-storage" className="pb-4">
      <span className="flex flex-col gap-1 border-b border-border pt-3 pb-3">
        <span className="font-medium">Your own storage</span>
        <span className="text-[14px] leading-normal text-pretty text-muted">
          Connect an S3-compatible bucket (Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO) and your recordings are stored there instead: the pieces guests upload, the finished files and
          the transcripts. Sessions you open from then on use it; earlier recordings stay where they are.
        </span>
      </span>

      {view.required && !t?.verified && (
        <Notice tone="warn" className="mt-3" data-testid="own-storage-required">
          Your plan records into your own bucket, and none is connected yet: you can&apos;t open a studio until one is.
        </Notice>
      )}

      {t && !editing && (
        <div className="flex flex-col gap-3 pt-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Bucket</dt>
            <dd className="break-all" data-testid="own-storage-bucket">
              {t.bucket}
            </dd>
            <dt className="text-muted">Endpoint</dt>
            <dd className="break-all">{t.endpoint ?? "Amazon S3"}</dd>
            <dt className="text-muted">Region</dt>
            <dd>{t.region}</dd>
            <dt className="text-muted">Access key</dt>
            <dd>ends in {t.accessKeyEnding}</dd>
          </dl>
          {t.verified ? (
            <Notice tone="ok" data-testid="own-storage-connected">
              Connected. Sessions you open from now on record into this bucket.
            </Notice>
          ) : busy === "check" ? (
            <Notice className="flex items-center gap-2">
              <Spinner /> Trying an upload from this browser…
            </Notice>
          ) : (
            <Notice tone="warn" data-testid="own-storage-unproven">
              Saved, but not in use yet. {blocked ?? "An upload from a browser hasn't been tried."} Guests upload straight from their browsers, so the bucket must allow uploads from this
              address. Add this as the bucket&apos;s CORS rules, then check again:
              <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-[13px] leading-relaxed text-text-2">{cors}</pre>
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            {!t.verified && (
              <Button type="button" size="sm" disabled={busy !== null} onClick={check}>
                Check again
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button type="button" variant="danger" size="sm" disabled={busy !== null} onClick={remove}>
              {busy === "remove" ? "Removing…" : "Stop using it"}
            </Button>
          </div>
          <span className="text-[14px] leading-normal text-pretty text-muted">
            Stopping or changing only affects sessions you open afterwards. Recordings already in a bucket stay there, and Tapry keeps that bucket&apos;s settings to go on showing them.
          </span>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="flex flex-col gap-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bucket">
              <Input name="bucket" defaultValue={t?.bucket} required minLength={3} maxLength={63} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Region" hint="For Cloudflare R2: auto.">
              <Input name="region" defaultValue={t?.region} required maxLength={64} autoComplete="off" spellCheck={false} placeholder="eu-central-1" />
            </Field>
          </div>
          <Field label="Endpoint" hint="The S3 address of your provider, starting with https://. Leave empty for Amazon S3.">
            <Input name="endpoint" type="url" defaultValue={t?.endpoint ?? ""} maxLength={300} autoComplete="off" spellCheck={false} placeholder="https://…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Access key ID">
              <Input name="accessKeyId" required maxLength={200} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Secret access key" hint="Stored encrypted, and never shown again.">
              <Input name="secretAccessKey" type="password" required maxLength={500} autoComplete="off" />
            </Field>
          </div>
          <CheckboxRow name="forcePathStyle" defaultChecked={t?.forcePathStyle ?? true} label="Path-style addresses" description="Needed by most providers other than Amazon S3." />
          <span className="text-[14px] leading-normal text-pretty text-muted">
            Use a key that can only read, write and delete in this one bucket. Tapry writes a small test file and removes it, then tries an upload from this browser.
          </span>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "save" && <Spinner />}
              {busy === "save" ? "Checking the bucket…" : "Connect"}
            </Button>
            {t && (
              <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {!editing && error && (
        <Notice tone="danger" className="mt-3">
          {error}
        </Notice>
      )}
    </ListCard>
  );
}
