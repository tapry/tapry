"use client";

// The signed-in person's profile picture: shown in the dashboard, to the others in the account
// and to guests on the invite. The picture is cropped to a square and shrunk to 256 px in the
// browser before it is sent, so a phone photo of several megabytes goes up as a few kilobytes.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Avatar, Button, cn } from "./ui";

const SIZE = 256;

/** The middle square of a picture, at 256 px, as JPEG. */
async function squared(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // On white, so a see-through PNG doesn't turn black as a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", 0.88));
}

export function AvatarEditor({ name, initial }: { name: string; initial: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setProblem(null);
    try {
      setUrl(await work());
      router.refresh(); // the sidebar shows it too
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "That picture couldn't be used. Try a PNG or JPEG.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(picked: File) {
    const res = await fetch("/api/auth/avatar", { method: "PUT", body: await squared(picked), credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiRequestError(res.status, data?.error ?? "unknown", data?.message ?? "Couldn't upload the picture.");
    return (data as { avatarUrl: string }).avatarUrl;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-divider py-4" data-testid="avatar-editor">
      <span className="flex min-w-0 flex-[1_1_220px] items-center gap-3.5">
        <Avatar name={name} src={url} className="size-12 text-base" />
        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-medium">Picture</span>
          <span className="text-[14px] leading-normal text-muted">Shown in the dashboard, to the others in your account and to guests on the invite.</span>
          {problem && (
            <span role="alert" className={cn("text-[14px] text-danger")}>
              {problem}
            </span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-2.5">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Picture file"
          data-testid="avatar-file"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) void run(() => upload(picked));
          }}
        />
        {url && (
          <Button type="button" variant="link" disabled={busy} onClick={() => void run(async () => (await apiFetch("/auth/avatar", { method: "DELETE" }), null))}>
            Remove
          </Button>
        )}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => file.current?.click()}>
          {url ? "Change picture" : "Upload a picture"}
        </Button>
      </span>
    </div>
  );
}
