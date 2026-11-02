"use client";

// The free upload-speed check. Test data goes to a Tapry server's public speed test
// (NEXT_PUBLIC_SPEED_TEST_URL, whose SPEED_TEST_ORIGINS must include this site) and is thrown
// away there. The measuring and the per-show needs are copied from the app
// (apps/web/src/lib/client/tech-check.ts: measureUpload, neededMbps); keep them in step.
import { useState, type CSSProperties } from "react";

export const SPEED_TEST_URL = process.env.NEXT_PUBLIC_SPEED_TEST_URL;

/** Mbit/s each kind of show sends while recording: the recording plus the live call. */
const NEEDS = [
  { kind: "Sound only", mbps: 0.18 },
  { kind: "Standard video (720p)", mbps: 5.0 },
  { kind: "Full HD video (1080p)", mbps: 9.0 },
];

async function measureUpload(url: string, forMs = 5_000, maxBytes = 32 * 1024 * 1024) {
  const MAX_PIECE = 8 * 1024 * 1024;
  const data = new Uint8Array(MAX_PIECE);
  crypto.getRandomValues(data.subarray(0, 65_536));
  let size = 256 * 1024;
  let sent = 0;
  let bytes = 0;
  let seconds = 0;
  let first: { bytes: number; seconds: number } | null = null;
  const start = performance.now();
  try {
    while (sent < maxBytes && (sent === 0 || performance.now() - start < forMs)) {
      const t0 = performance.now();
      const res = await fetch(url, { method: "POST", body: data.subarray(0, size), signal: AbortSignal.timeout(30_000) });
      const dt = (performance.now() - t0) / 1000;
      if (!res.ok) break;
      sent += size;
      if (first) {
        bytes += size;
        seconds += dt;
      } else {
        first = { bytes: size, seconds: dt };
      }
      if (dt < 0.75) size = Math.min(size * 2, MAX_PIECE);
    }
  } catch {
    // Offline, limited or timed out: report what got through.
  }
  if (seconds === 0) return first ? (first.bytes * 8) / first.seconds / 1_000_000 : null;
  return (bytes * 8) / seconds / 1_000_000;
}

const mbit = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));

export function UploadSpeedTest() {
  const [state, setState] = useState<{ status: "idle" | "testing" } | { status: "done"; mbps: number | null }>({ status: "idle" });
  if (!SPEED_TEST_URL) {
    return <div style={card}>The speed test isn’t connected to a server on this copy of the site.</div>;
  }
  const endpoint = `${SPEED_TEST_URL.replace(/\/$/, "")}/api/speed-test`;

  async function run() {
    setState({ status: "testing" });
    setState({ status: "done", mbps: await measureUpload(endpoint) });
  }

  return (
    <div style={{ ...card, gap: 22 }} data-testid="upload-speed">
      {state.status === "done" && state.mbps !== null && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-.04em", lineHeight: 1 }} data-testid="upload-mbps">
              {mbit(state.mbps)}
            </span>
            <span style={{ fontSize: 19, color: "#6e6e73" }}>Mbit/s upload</span>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12, fontSize: 17 }}>
            {NEEDS.map((n) => {
              const ok = state.mbps! >= n.mbps * 1.2;
              return (
                <li key={n.kind} style={{ display: "flex", gap: 12, alignItems: "flex-start" }} data-verdict={ok ? "ok" : "slow"}>
                  <span aria-hidden style={{ flexShrink: 0, marginTop: 2, width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, background: ok ? "#e6f6ec" : "#fff4dc", color: ok ? "#1f7a45" : "#8a5a0c" }}>
                    {ok ? "✓" : "!"}
                  </span>
                  <span>
                    <strong style={{ fontWeight: 600 }}>{n.kind}</strong>
                    <span style={{ color: "#6e6e73" }}>
                      {ok ? ": keeps up while you record" : `: needs about ${mbit(n.mbps)} Mbit/s, so the upload finishes after the session`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {state.status === "done" && state.mbps === null && (
        <div role="alert" style={{ borderRadius: 12, padding: "12px 14px", background: "#fdece8", color: "#a3321f" }}>
          The test couldn’t reach the server. Check your connection and try again.
        </div>
      )}
      <button type="button" className="cta" onClick={run} disabled={state.status === "testing"} style={button}>
        {state.status === "testing" ? "Testing your upload…" : state.status === "done" ? "Test again" : "Test my upload"}
      </button>
    </div>
  );
}

const card: CSSProperties = { display: "flex", flexDirection: "column", borderRadius: 22, background: "#ffffff", padding: 28, boxShadow: "0 0 0 1px #ececef, 0 10px 30px -18px rgba(0,0,0,.18)", fontSize: 16 };
const button: CSSProperties = { alignSelf: "flex-start", cursor: "pointer", border: 0, padding: "17px 28px", borderRadius: 14, background: "#e8553d", color: "#ffffff", font: "600 18px var(--sans)", boxShadow: "0 10px 24px -10px rgba(232,85,61,.7)" };
