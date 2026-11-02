"use client";

import { useState } from "react";
import { Button, cn, Notice } from "@/components/ui";
import { measureUpload, uploadVerdicts } from "@/lib/client/tech-check";

const mbit = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));

/** Run the upload test and say which kinds of recording the line keeps up with. */
export function UploadSpeed({ endpoint }: { endpoint: string }) {
  const [state, setState] = useState<{ status: "idle" | "testing" } | { status: "done"; mbps: number | null }>({ status: "idle" });

  async function run() {
    setState({ status: "testing" });
    setState({ status: "done", mbps: await measureUpload(endpoint) });
  }

  return (
    <div className="flex flex-col gap-5 rounded-[20px] bg-surface p-6" data-testid="upload-speed">
      {state.status === "done" && state.mbps !== null && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[44px] leading-none font-bold tracking-[-.03em] tabular-nums" data-testid="upload-mbps">
              {mbit(state.mbps)}
            </span>
            <span className="text-lg text-muted">Mbit/s upload</span>
          </div>
          <ul className="flex flex-col gap-2.5 text-[15px]">
            {uploadVerdicts(state.mbps).map((v) => (
              <li key={v.kind} className="flex items-start gap-2.5" data-verdict={v.ok ? "ok" : "slow"}>
                <span
                  aria-hidden
                  className={cn(
                    "mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px]",
                    v.ok ? "bg-ok-soft text-ok-strong" : "bg-warn-soft text-warn-strong",
                  )}
                >
                  {v.ok ? "✓" : "!"}
                </span>
                <span>
                  <span className="font-medium">{v.kind}</span>
                  <span className="text-muted">
                    {v.ok ? ": keeps up while you record" : `: needs about ${mbit(v.needed)} Mbit/s, so the upload finishes after the session`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            Whatever the speed, everything is kept on your computer while you record and sent as fast as your line allows. A slow
            upload never loses anything; it only means waiting a little at the end with the page open.
          </p>
        </>
      )}
      {state.status === "done" && state.mbps === null && (
        <Notice tone="danger">The test couldn&apos;t reach the server. Check your connection and try again.</Notice>
      )}
      <Button onClick={run} disabled={state.status === "testing"} className="self-start">
        {state.status === "testing" ? "Testing your upload…" : state.status === "done" ? "Test again" : "Test my upload"}
      </Button>
    </div>
  );
}
