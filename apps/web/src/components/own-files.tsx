import type { OwnRecordings } from "@tapry/shared";
import { StatusDot } from "@/components/ui";
import { mb } from "@/lib/format";

/** A participant's own files, recording by recording: on their end screen and the emailed page. */
export function OwnFiles({ recordings, waiting }: { recordings: OwnRecordings["recordings"]; waiting: string }) {
  const several = recordings.length > 1;
  return (
    <>
      {recordings.map((r) => (
        <div key={r.number} className="flex flex-col gap-2">
          {several && <span className="text-sm text-muted">Recording {r.number}</span>}
          {r.processing === "ready" && r.files.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {r.files.map((f) => (
                <a
                  key={f.url}
                  href={f.url}
                  data-file-name={f.fileName}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium hover:border-muted"
                >
                  {f.kind === "audio" ? "∿ Your audio" : "▶ Your video"}
                  <span className="font-normal text-muted">
                    {f.fileName.split(".").pop()!.toUpperCase()} · {mb(f.bytes)}
                  </span>
                </a>
              ))}
            </div>
          ) : r.processing === "failed" ? (
            <p className="text-sm text-muted">Your file couldn&apos;t be prepared here. The host has your recording.</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <StatusDot tone="warn" className="animate-rec-pulse" />
              {waiting}
            </p>
          )}
        </div>
      ))}
    </>
  );
}
