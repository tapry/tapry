"use client";

// The solo recorder: record yourself (microphone, and camera if you like) in the browser and
// save the file to your own computer. Nothing is uploaded: the recording exists only in this
// tab until you save it, and is gone when you close the tab.
import { useEffect, useRef, useState, type CSSProperties } from "react";

const TYPES = { video: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"], audio: ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"] };
const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
/** An hour is plenty for a tab's memory; past this the recorder stops by itself. */
const MAX_MS = 60 * 60 * 1000;

const btn = (dark: boolean): CSSProperties => ({ display: "inline-flex", height: 38, alignItems: "center", borderRadius: 10, padding: "0 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: `1px solid ${dark ? "#0b0b0f" : "#e6e6e9"}`, background: dark ? "#0b0b0f" : "#fff", color: dark ? "#fff" : "#0b0b0f" });

export function RecorderCard() {
  const [camera, setCamera] = useState(false);
  const [state, setState] = useState<"idle" | "asking" | "recording" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ url: string; name: string; bytes: number; video: boolean } | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => release, []);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  async function start() {
    setError(null);
    setState("asking");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: camera ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : false });
      stream.current = media;
      if (preview.current) preview.current.srcObject = camera ? media : null;
      const mimeType = TYPES[camera ? "video" : "audio"].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) throw new Error("unsupported");
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(media, { mimeType, audioBitsPerSecond: 128_000, ...(camera ? { videoBitsPerSecond: 8_000_000 } : {}) });
      const began = performance.now();
      const tick = setInterval(() => {
        const ms = performance.now() - began;
        setElapsed(ms);
        if (ms >= MAX_MS) rec.stop();
      }, 250);
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(tick);
        release();
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes("mp4") ? (camera ? "mp4" : "m4a") : mimeType.includes("ogg") ? "ogg" : "webm";
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
        setResult({ url: URL.createObjectURL(blob), name: `Recording ${stamp}.${ext}`, bytes: blob.size, video: camera });
        setState("done");
      };
      recorder.current = rec;
      rec.start(1000);
      setElapsed(0);
      setState("recording");
    } catch (err) {
      release();
      setState("idle");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Your browser didn't allow the microphone. Allow it for this page (the icon in the address bar) and try again."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone was found. Plug one in and try again."
            : "This browser can't record here. Try a current Chrome, Firefox or Safari.",
      );
    }
  }

  function again() {
    setResult(null);
    setElapsed(0);
    setState("idle");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, border: "1px solid #ececef", borderRadius: 20, background: "#fff", padding: 22 }} data-testid="recorder-card" data-state={state}>
      {camera && state !== "done" && (
        <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", borderRadius: 14, background: "#18181b" }}>
          <video ref={preview} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
        </div>
      )}
      {state === "done" && result ? (
        <>
          {result.video ? <video src={result.url} controls playsInline style={{ width: "100%", borderRadius: 14, background: "#18181b" }} /> : <audio src={result.url} controls style={{ width: "100%" }} />}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <a href={result.url} download={result.name} style={{ ...btn(true), textDecoration: "none" }} data-testid="recorder-save">
              Save the recording
            </a>
            <button type="button" style={btn(false)} onClick={again}>
              Record again
            </button>
            <span style={{ fontSize: 13.5, color: "#6b6b70" }}>
              {clock(elapsed)} · {(result.bytes / 1_048_576).toFixed(1)} MB
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#6b6b70" }}>It exists only in this tab. Save it now: closing the tab or recording again removes it.</p>
        </>
      ) : (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14.5, cursor: state === "idle" ? "pointer" : "default" }}>
            <input type="checkbox" checked={camera} disabled={state !== "idle"} onChange={(e) => setCamera(e.target.checked)} /> Record my camera too
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {state === "recording" ? (
              <button type="button" style={{ ...btn(true), background: "#c43c25", borderColor: "#c43c25" }} onClick={() => recorder.current?.stop()}>
                Stop
              </button>
            ) : (
              <button type="button" style={btn(true)} disabled={state === "asking"} onClick={() => void start()}>
                {state === "asking" ? "Asking for your microphone…" : "Start recording"}
              </button>
            )}
            <span role="status" style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: state === "recording" ? "#c43c25" : "#6b6b70" }}>
              {state === "recording" ? `● ${clock(elapsed)}` : "Up to an hour"}
            </span>
          </div>
        </>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 14, color: "#c43c25" }}>
          {error}
        </p>
      )}
    </div>
  );
}
