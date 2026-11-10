"use client";

import { useState } from "react";
import { Button, cn, Notice } from "@/components/ui";
import { Icon, Spinner } from "@/components/ui-extra";
import { measureUpload, uploadVerdicts } from "@/lib/client/tech-check";

const mbit = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));

/** Run the upload test and say which kinds of recording the line keeps up with. */
export function UploadSpeed({ endpoint }: { endpoint: string }) {
  const [state, setState] = useState<{ status: "idle" | "testing" } | { status: "done"; mbps: number | null }>({ status: "idle" });

  async function run() {
    setState({ status: "testing" });
    setState({ status: "done", mbps: await measureUpload(endpoint) });
  }

  const done = state.status === "done" && state.mbps !== null;
  return (
    <div className="flex flex-col gap-[18px] rounded-[20px] border border-border bg-surface p-[clamp(20px,4vw,28px)]" data-testid="upload-speed">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[22px] font-medium tracking-[-.02em]">Upload speed test</h2>
        <p className="text-[15px] leading-[1.55] text-muted">Everything is kept on your computer while you record, and sent as fast as your line allows.</p>
      </div>
      <div
        className="flex flex-col items-center gap-1.5 rounded-[14px] px-5 py-9"
        style={{ background: "linear-gradient(200deg,var(--accent-tint),var(--accent-soft))" }}
      >
        <span className="text-[64px] leading-none font-medium tracking-[-.04em] tabular-nums" data-testid={done ? "upload-mbps" : undefined}>
          {state.status === "done" && state.mbps !== null ? mbit(state.mbps) : "—"}
        </span>
        <span className="text-sm text-muted">Mbit/s upload</span>
      </div>
      <Button size="lg" onClick={run} disabled={state.status === "testing"} className="disabled:opacity-70">
        {state.status === "testing" && <Spinner />}
        {state.status === "testing" ? "Testing your upload…" : state.status === "done" ? "Test again" : "Test my upload"}
      </Button>
      {state.status === "done" && state.mbps !== null && (
        <>
          <ul className="flex flex-col gap-2 text-[14.5px]">
            {uploadVerdicts(state.mbps).map((v) => (
              <li key={v.kind} className="flex items-start gap-2" data-verdict={v.ok ? "ok" : "slow"}>
                <Icon name={v.ok ? "check" : "alert"} className={cn("mt-0.5", v.ok ? "text-ok-strong" : "text-warn-strong")} />
                <span>
                  <span className={cn("font-medium", v.ok ? "text-ok-strong" : "text-warn-strong")}>{v.kind}</span>
                  <span className="text-text-2">
                    {v.ok ? ": keeps up while you record" : `: needs about ${mbit(v.needed)} Mbit/s, so the upload finishes after the session`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-normal text-muted">
            Whatever the speed, everything is kept on your computer while you record and sent as fast as your line allows. A slow
            upload never loses anything; it only means waiting a little at the end with the page open.
          </p>
        </>
      )}
      {state.status === "done" && state.mbps === null && (
        <Notice tone="danger">The test couldn&apos;t reach the server. Check your connection and try again.</Notice>
      )}
    </div>
  );
}
