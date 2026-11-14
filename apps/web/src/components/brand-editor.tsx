"use client";

// A studio's branding: a logo and a colour for the pages its guests open (invite, tech check,
// green room, solo link, share page). The dashboard keeps Tapry's look.
import { useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import type { BrandSettings } from "@/server/brand";
import { Button, cn, LogoMark } from "./ui";
import { ListCard } from "./ui-extra";

const TAPRY_ACCENT = "#e8553d";

export function BrandEditor({ studioId, studioName, initial }: { studioId: string; studioName: string; initial: BrandSettings }) {
  const [brand, setBrand] = useState(initial);
  const [accent, setAccent] = useState(initial.accent ?? TAPRY_ACCENT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<BrandSettings>) {
    setBusy(true);
    setStatus(null);
    try {
      const next = await fn();
      setBrand(next);
      setAccent(next.accent ?? TAPRY_ACCENT);
      setStatus({ tone: "ok", text: "✓ Saved" });
    } catch (err) {
      setStatus({ tone: "danger", text: err instanceof ApiRequestError ? err.message : "Couldn't save. Try again." });
    } finally {
      setBusy(false);
    }
  }

  /** The image is the request's body, as it is: nothing is re-encoded in the browser. */
  async function upload(picked: File) {
    const res = await fetch(`/api/studios/${studioId}/brand/logo`, { method: "PUT", body: picked, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiRequestError(res.status, data?.error ?? "unknown", data?.message ?? "Couldn't upload the logo.");
    return data as BrandSettings;
  }

  const shown = brand.accent ?? TAPRY_ACCENT;
  return (
    <ListCard data-testid="brand-editor">
      <div className="flex flex-col gap-4 py-4">
        <span className="flex flex-col gap-[3px]">
          <span className="font-medium">Branding</span>
          <span className="text-[13px] leading-normal text-pretty text-muted">
            Your logo and colour on the pages guests open: the invite, the tech check, the green room, the solo link and shared recordings. Your dashboard keeps its look.
          </span>
        </span>

        {!brand.allowed && (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-muted" data-testid="brand-plan">
            Branding is part of the Studio plan and up.{brand.accent || brand.logoUrl ? " What you set earlier is kept, and not shown to guests." : ""}
          </p>
        )}

        {/* How the top of a guest page will look. */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5" aria-label="Preview">
          <span className="flex min-w-0 items-center gap-[9px] text-[15px] font-medium">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="Your logo" className="h-6 w-auto max-w-[120px] rounded-[4px] object-contain" />
            ) : (
              <LogoMark className="size-6" />
            )}
            <span className="truncate">{studioName}</span>
          </span>
          <span className="rounded-md px-3 py-1.5 text-[13px] font-medium" style={{ background: shown, color: brand.accent ? (brand.accentText ?? "#fff") : "#fff" }}>
            Join
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Logo file"
            data-testid="brand-logo-file"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) void run(() => upload(picked));
            }}
          />
          <Button type="button" variant="secondary" disabled={busy || !brand.allowed} onClick={() => file.current?.click()}>
            {brand.logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {brand.logoUrl && (
            <Button type="button" variant="link" disabled={busy} onClick={() => void run(() => apiFetch<BrandSettings>(`/studios/${studioId}/brand/logo`, { method: "DELETE" }))}>
              Remove logo
            </Button>
          )}
          <span className="text-[13px] text-muted">PNG, JPEG or WebP, 512 KB at most.</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              disabled={busy || !brand.allowed}
              data-testid="brand-accent"
              className="size-[34px] cursor-pointer rounded-md border border-border bg-surface p-[3px] disabled:cursor-not-allowed"
            />
            Colour
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !brand.allowed || accent.toLowerCase() === (brand.accent ?? "")}
            onClick={() => void run(() => apiFetch<BrandSettings>(`/studios/${studioId}/brand`, { method: "PUT", body: { accent } }))}
          >
            Use this colour
          </Button>
          {brand.accent && (
            <Button type="button" variant="link" disabled={busy} onClick={() => void run(() => apiFetch<BrandSettings>(`/studios/${studioId}/brand`, { method: "PUT", body: { accent: null } }))}>
              Back to Tapry&apos;s
            </Button>
          )}
          {status && <span className={cn("text-sm", status.tone === "ok" ? "text-ok-strong" : "text-danger")}>{status.text}</span>}
        </div>
      </div>
    </ListCard>
  );
}
