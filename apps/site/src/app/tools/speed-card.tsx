"use client";

// The free upload-speed check, in the Tools design's card. Test data goes to a Tapry server's
// public speed test (NEXT_PUBLIC_SPEED_TEST_URL, whose SPEED_TEST_ORIGINS must include this site)
// and is thrown away there. The number shown while testing is the measurement so far, never an
// animation. The measuring and the per-studio needs are copied from the app
// (apps/web/src/lib/client/tech-check.ts: measureUpload, neededMbps); keep them in step.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SPEED_TEST_URL } from "@/content/site";

/** Mbit/s each kind of studio sends while recording: the recording plus the live call. */
const NEEDS = [
  { kind: "Sound only", mbps: 0.18 },
  { kind: "Standard video (720p)", mbps: 5.0 },
  { kind: "Full HD video (1080p)", mbps: 9.0 },
  { kind: "4K video", mbps: 25.0 },
];
const FOR_MS = 5_000;

/** Called with the measurement so far each time a piece arrives. */
type Progress = (mbps: number | null) => void;

async function measureUpload(url: string, onProgress: Progress, forMs = FOR_MS, maxBytes = 32 * 1024 * 1024) {
  const MAX_PIECE = 8 * 1024 * 1024;
  const data = new Uint8Array(MAX_PIECE);
  crypto.getRandomValues(data.subarray(0, 65_536));
  let size = 256 * 1024;
  let sent = 0;
  let bytes = 0;
  let seconds = 0;
  let first: { bytes: number; seconds: number } | null = null;
  const start = performance.now();
  const estimate = () => (seconds > 0 ? (bytes * 8) / seconds / 1_000_000 : first ? (first.bytes * 8) / first.seconds / 1_000_000 : null);
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
      onProgress(estimate());
      if (dt < 0.75) size = Math.min(size * 2, MAX_PIECE);
    }
  } catch {
    // Offline, limited or timed out: report what got through.
  }
  return estimate();
}

const mbit = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));

export function SpeedCard() {
  const [state, setState] = useState<{ status: "idle" } | { status: "testing"; mbps: number | null; fraction: number } | { status: "done"; mbps: number | null }>({ status: "idle" });

  // The progress timer, so leaving the page mid-test stops it.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (!SPEED_TEST_URL) {
    return (
      <div id="speed" style={card}>
        <Head />
        <p style={{ margin: 0, fontSize: 15, color: "#5f6470" }}>The speed test isn’t connected to a server on this copy of the site.</p>
      </div>
    );
  }
  const endpoint = `${SPEED_TEST_URL.replace(/\/$/, "")}/api/speed-test`;

  async function run() {
    setState({ status: "testing", mbps: null, fraction: 0 });
    const start = performance.now();
    // The bar follows the clock between pieces too; the number only changes when a piece lands.
    let latest: number | null = null;
    timer.current = setInterval(() => setState({ status: "testing", mbps: latest, fraction: Math.min(1, (performance.now() - start) / FOR_MS) }), 100);
    const mbps = await measureUpload(endpoint, (m) => {
      latest = m;
    });
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (alive.current) setState({ status: "done", mbps });
  }

  const busy = state.status === "testing";
  const shown = state.status === "idle" ? null : state.mbps;
  const pct = state.status === "testing" ? state.fraction * 100 : state.status === "done" && state.mbps !== null ? 100 : 0;

  return (
    <div id="speed" data-testid="upload-speed" style={card}>
      <Head />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, borderRadius: 14, background: "linear-gradient(200deg,#fdf3ef,#fbe3d8)", padding: "36px 20px" }}>
        <span data-testid={state.status === "done" && state.mbps !== null ? "upload-mbps" : undefined} aria-live="polite" style={{ fontSize: 64, lineHeight: 1, fontWeight: 500, letterSpacing: "-.04em", fontVariantNumeric: "tabular-nums" }}>
          {shown === null ? "—" : mbit(shown)}
        </span>
        <span style={{ fontSize: 14, color: "#5f6470" }}>Mbit/s upload</span>
        <span aria-hidden="true" style={{ width: "100%", maxWidth: 320, height: 6, marginTop: 14, overflow: "hidden", borderRadius: 3, background: "rgba(255,255,255,.7)" }}>
          <span style={{ display: "block", height: "100%", borderRadius: 3, background: "#e8553d", transition: "width .2s linear", width: `${pct}%` }} />
        </span>
      </div>
      <button
        type="button"
        className="speed-btn"
        onClick={run}
        disabled={busy}
        style={{ display: "flex", height: 42, cursor: busy ? "default" : "pointer", alignItems: "center", justifyContent: "center", border: 0, borderRadius: 10, background: "#0b0b0f", fontSize: 15, fontWeight: 500, color: "#fff", transition: "opacity .2s", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Measuring…" : state.status === "done" ? "Run again" : "Run the test"}
      </button>
      {state.status === "done" && state.mbps !== null && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, fontSize: 14.5, color: "#3f3f46" }}>
          {NEEDS.map((n) => {
            const ok = state.mbps! >= n.mbps * 1.2;
            return (
              <li key={n.kind} data-verdict={ok ? "ok" : "slow"} style={{ color: ok ? "#15803d" : "#b45309" }}>
                {ok ? `✓ ${n.kind} keeps up while you record` : `! ${n.kind} needs about ${mbit(n.mbps)} Mbit/s, so its upload finishes after the session`}
              </li>
            );
          })}
        </ul>
      )}
      {state.status === "done" && state.mbps === null && (
        <span role="alert" style={{ fontSize: 14.5, color: "#c43c25" }}>
          The test couldn’t reach the server. Check your connection and try again.
        </span>
      )}
    </div>
  );
}

function Head() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: "-.02em" }}>Upload speed test</h2>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "#5f6470" }}>Recording depends on upload, not download. This measures the direction that matters; the test data is thrown away.</p>
    </div>
  );
}

const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 18, border: "1px solid #e4e4e7", borderRadius: 20, padding: 28, background: "#fff", scrollMarginTop: 80 };
