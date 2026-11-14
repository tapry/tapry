"use client";

import { useT } from "@/lib/i18n/client";
import type { OwnRecordings } from "@tapry/shared";
import { StatusDot } from "@/components/ui";
import { Icon } from "@/components/ui-extra";
import { isOriginalAudio } from "@/components/recordings";
import { mb } from "@/lib/format";

/** A participant's own files, recording by recording: on their end screen and the emailed page. */
export function OwnFiles({ recordings, waiting }: { recordings: OwnRecordings["recordings"]; waiting: string }) {
  const { t } = useT();
  const several = recordings.length > 1;
  return (
    <>
      {recordings.map((r) => (
        <div key={r.number} className="flex flex-col gap-2">
          {several && <span className="text-[13px] text-muted">{t("files.recordingN", { n: r.number })}</span>}
          {r.processing === "ready" && r.files.length > 0 ? (
            <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] py-1">
              {r.files.map((f, i) => (
                <a
                  key={f.url}
                  href={f.url}
                  data-file-name={f.fileName}
                  className={
                    "group flex items-center justify-between gap-3 py-2.5 text-text hover:text-text" + (i > 0 ? " border-t border-divider" : "")
                  }
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon name={f.kind === "audio" ? "wave" : f.kind === "screen" ? "screen" : "camera"} size={15} className="text-muted" />
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="truncate">
                        {f.kind === "audio" ? t("files.audio") : f.kind === "screen" ? t("files.screen") : t("files.video")}
                        {isOriginalAudio(f.fileName) && ` ${t("files.original")}`}
                      </span>
                      <span className="text-[12.5px] text-muted">
                        {f.fileName.split(".").pop()!.toUpperCase()} · {mb(f.bytes)}
                      </span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface transition-colors group-hover:bg-surface-2"
                  >
                    <Icon name="download" size={15} />
                  </span>
                </a>
              ))}
            </div>
          ) : r.processing === "failed" || r.processing === "ready" ? (
            <p className="text-sm text-muted">{t("files.failed")}</p>
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
