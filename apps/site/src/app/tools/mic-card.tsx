"use client";

// The free mic & camera test, in the Tools design's card. Everything happens in the visitor's
// browser, nothing is sent anywhere. Every number shown is measured: the level bars are the
// microphone's real level over the last second or so. The thresholds are the app's green room's
// (apps/web/src/lib/media/media.ts, classifyLevel), so "sounds good" means the same as in a studio.
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Level = "silent" | "quiet" | "good" | "loud";
const ADVICE: Record<Level, string> = {
  silent: "We can’t hear anything. Say something, or pick another microphone.",
  quiet: "A bit quiet. Move closer to the mic or turn up its input level.",
  good: "Level sounds good",
  loud: "Too loud: the sound is distorting. Move back a little or lower the input level.",
};
/** The meter's colour says the same as the advice: grey silent, amber quiet, green good, coral too loud. */
const LEVEL_COLOR: Record<Level, string> = { silent: "#a1a1aa", quiet: "#d08a0b", good: "#1f9d55", loud: "#e8553d" };
const SAMPLE_SECONDS = 5;
const BARS = 28;
/** Headsets whose mic uses the Bluetooth call profile: narrowband, sounds like a phone. */
const BLUETOOTH = /airpods|bluetooth|hands-?free|headset|buds|bose|jabra|beats|wh-1000/i;
const OK = "#15803d";
const WARN = "#b45309";

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -100);

function classify(loudestRmsDb: number, peakDb: number): Level {
  if (peakDb > -1) return "loud";
  if (loudestRmsDb < -60) return "silent";
  if (loudestRmsDb < -38) return "quiet";
  return "good";
}

export function MicCard() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [withCamera, setWithCamera] = useState(true);

  async function start(mic = micId, cam = camId, camera = withCamera) {
    setError(null);
    setBusy(true);
    stream?.getTracks().forEach((t) => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        // Raw, the way Tapry records someone on headphones: no processing to hide problems.
        audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: camera ? { ...(cam ? { deviceId: { exact: cam } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } } : false,
      });
      setStream(s);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "default"));
      setCams(devices.filter((d) => d.kind === "videoinput"));
    } catch (e) {
      setStream(null);
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Your browser blocked the microphone or camera. Click the camera icon in the address bar, allow access for this page, and try again."
          : name === "NotFoundError"
            ? "No microphone or camera found. Plug one in, or test the microphone only."
            : name === "NotReadableError"
              ? "Another app is using your microphone or camera. Close it (Zoom, Teams, FaceTime…) and try again."
              : "Couldn’t open your microphone or camera. Try again, or try another browser.",
      );
    } finally {
      setBusy(false);
    }
  }
  function stop() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  const on = stream !== null;
  const audio = stream?.getAudioTracks()[0] ?? null;
  const video = stream?.getVideoTracks()[0] ?? null;
  const meter = useMeter(audio);

  const settings = audio?.getSettings();
  const label = audio?.label ?? "";
  const bluetooth = !!audio && (BLUETOOTH.test(label) || (!!settings?.sampleRate && settings.sampleRate <= 16_000));
  const camera = useCameraInfo(video);
  const buttonLabel = on ? "Stop the test" : "Start the test";

  return (
    <div id="mic" data-testid="mic-panel" style={card}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={h2}>Mic &amp; camera test</h2>
        <p style={desc}>See how you look and whether your microphone is too quiet, too loud or just right. Nothing is recorded or sent anywhere.</p>
      </div>

      <div data-testid={video ? "camera-panel" : undefined} style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", borderRadius: 14, background: "#18181b" }}>
        {video && stream && <CameraView stream={stream} onSize={camera.setSize} />}
        {!video && (
          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 16, textAlign: "center", fontSize: 14.5, color: "rgba(255,255,255,.8)" }}>
            {on ? "Microphone only: no camera" : "Your camera appears here"}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ position: "relative", display: "grid", width: 48, height: 48, flexShrink: 0, placeItems: "center" }}>
          {on && (
            <>
              <span aria-hidden="true" style={{ ...ring, animation: "ring2 1.8s cubic-bezier(.2,.7,.2,1) infinite" }} />
              <span aria-hidden="true" style={{ ...ring, animation: "ring2 1.8s cubic-bezier(.2,.7,.2,1) .6s infinite" }} />
            </>
          )}
          <button
            type="button"
            className="mic-btn"
            onClick={() => (on ? stop() : start())}
            disabled={busy}
            aria-label={buttonLabel}
            style={{ position: "relative", display: "grid", width: 48, height: 48, placeItems: "center", border: 0, borderRadius: "50%", cursor: "pointer", padding: 0, background: "#e8553d", color: "#fff" }}
          >
            {on ? (
              <span style={{ width: 15, height: 15, borderRadius: 3, background: "#fff" }} />
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19v3M19 10v2a7 7 0 0 1-14 0v-2M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z" />
              </svg>
            )}
          </button>
        </span>
        <span style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{busy ? "Asking for your microphone…" : on ? (meter.suspended ? "Click anywhere to start the meter" : "Listening… say a few words") : "Start the test"}</span>
          <span
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={-60}
            aria-valuemax={0}
            aria-valuenow={Math.round(Math.max(-60, meter.rmsDb))}
            style={{ display: "flex", height: 22, alignItems: "center", gap: 3, borderRadius: 999, background: "#f4f4f5", padding: "0 12px" }}
          >
            {meter.bars.map((v, k) => (
              <span key={k} style={{ flex: "1 1 0", maxWidth: 4, height: 16, borderRadius: 2, background: on && !meter.suspended ? LEVEL_COLOR[meter.level] : "#d4d4d8", transition: "transform 60ms linear, background .2s", transform: `scaleY(${on ? Math.max(0.15, v) : 0.15})` }} />
            ))}
          </span>
        </span>
      </div>

      {!on && !busy && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, color: "#5f6470" }}>
          <input type="checkbox" checked={!withCamera} onChange={(e) => setWithCamera(!e.target.checked)} />
          Microphone only
        </label>
      )}

      {error && (
        <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14.5, lineHeight: 1.5, color: "#c43c25" }}>
          {error}
          <button type="button" onClick={() => start()} style={{ ...secondary, alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      )}

      {on && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14.5, color: "#3f3f46" }}>
          <span data-testid="mic-advice" data-level={meter.level} style={{ color: meter.suspended || meter.level === "silent" ? "#5f6470" : meter.level === "good" ? OK : WARN }}>
            {/* Until the browser lets the meter run there is nothing measured to give advice on. */}
            {meter.suspended ? "Click anywhere to start the meter" : meter.level === "good" ? `✓ ${ADVICE.good} (peaks around ${Math.round(meter.peakDb)} dB)` : `! ${ADVICE[meter.level]}`}
          </span>
          {video && camera.text && <span style={{ color: camera.low ? WARN : OK }}>{camera.low ? `! Camera gives ${camera.text}, less than HD. Check its settings, close other apps using it, or try another camera.` : `✓ Camera: ${camera.text}`}</span>}
          {bluetooth && (
            <span data-testid="bluetooth-note" style={{ color: WARN }}>
              ! This looks like a Bluetooth headset’s microphone, which makes you sound like a phone call. Keep the headphones for listening and speak into your computer’s microphone or a USB mic.
            </span>
          )}
        </div>
      )}

      {on && stream && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid #e4e4e7", paddingTop: 18 }}>
          <DevicePicker label="Microphone" devices={mics} value={micId || mics.find((d) => d.label === label)?.deviceId || ""} onPick={(id) => (setMicId(id), start(id, camId))} />
          {video && <DevicePicker label="Camera" devices={cams} value={camId || cams.find((d) => d.label === video.label)?.deviceId || ""} onPick={(id) => (setCamId(id), start(micId, id))} />}
          <dl className="tool-details">
            <dt>Microphone</dt>
            <dd>{label || "Unknown"}</dd>
            {settings?.sampleRate && (
              <>
                <dt>Sample rate</dt>
                <dd>{(settings.sampleRate / 1000).toFixed(1)} kHz</dd>
              </>
            )}
            {settings?.channelCount && (
              <>
                <dt>Channels</dt>
                <dd>{settings.channelCount === 1 ? "Mono" : settings.channelCount === 2 ? "Stereo" : `${settings.channelCount} channels`}</dd>
              </>
            )}
            {video && (
              <>
                <dt>Camera</dt>
                <dd>{video.label || "Unknown"}</dd>
              </>
            )}
          </dl>
          <HearYourself stream={stream} />
        </div>
      )}
    </div>
  );
}

/** The microphone's level: shown value, the classification over the last 3 s, and the bars. */
function useMeter(track: MediaStreamTrack | null) {
  const [m, setM] = useState({ rmsDb: -100, peakDb: -100, level: "silent" as Level, bars: Array<number>(BARS).fill(0), suspended: false });
  useEffect(() => {
    if (!track) {
      setM({ rmsDb: -100, peakDb: -100, level: "silent", bars: Array<number>(BARS).fill(0), suspended: false });
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    void ctx.resume();
    const resume = () => void ctx.resume();
    window.addEventListener("pointerdown", resume);
    const buf = new Float32Array(analyser.fftSize);
    const history: Array<{ t: number; rms: number; peak: number }> = [];
    const bars: number[] = Array<number>(BARS).fill(0);
    let shown = -100;
    let last = performance.now();
    const id = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (const x of buf) {
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
      const now = performance.now();
      const rms = db(Math.sqrt(sum / buf.length));
      history.push({ t: now, rms, peak: db(peak) });
      while (history[0]!.t < now - 3000) history.shift();
      // Jumps up at once, falls back slowly (24 dB/s), like the app's meter.
      shown = Math.max(rms, shown - (24 * (now - last)) / 1000);
      last = now;
      bars.shift();
      bars.push(Math.min(1, Math.max(0, (rms + 60) / 60)));
      const loudest = Math.max(...history.map((h) => h.rms));
      const peakDb = Math.max(...history.map((h) => h.peak));
      setM({ rmsDb: shown, peakDb, level: classify(loudest, peakDb), bars: [...bars], suspended: ctx.state !== "running" });
    }, 50);
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", resume);
      void ctx.close();
    };
  }, [track]);
  return m;
}

function useCameraInfo(track: MediaStreamTrack | null) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setSize(null), [track]);
  if (!track) return { text: "", low: false, setSize };
  const s = track.getSettings();
  const w = size?.w ?? s.width;
  const h = size?.h ?? s.height;
  if (!h) return { text: "", low: false, setSize };
  const quality = h >= 1080 ? " (Full HD)" : h >= 720 ? " (HD)" : " (Low resolution)";
  const fps = s.frameRate ? `, ${Math.round(s.frameRate)} fps` : "";
  return { text: `${w}×${h}${quality}${fps}`, low: h < 720, setSize };
}

function CameraView({ stream, onSize }: { stream: MediaStream; onSize: (s: { w: number; h: number }) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      onLoadedMetadata={(e) => onSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
      style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
    />
  );
}

function HearYourself({ stream }: { stream: MediaStream }) {
  const [left, setLeft] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  // Leaving the test mid-recording (Stop, or another microphone) ends the countdown and the recorder.
  const running = useRef<{ tick: ReturnType<typeof setInterval>; recorder: MediaRecorder; clone: MediaStreamTrack } | null>(null);
  useEffect(
    () => () => {
      const r = running.current;
      if (!r) return;
      running.current = null;
      clearInterval(r.tick);
      r.recorder.ondataavailable = null;
      r.recorder.onstop = null;
      if (r.recorder.state !== "inactive") r.recorder.stop();
      r.clone.stop();
    },
    [],
  );

  function record() {
    const track = stream.getAudioTracks()[0];
    if (!track || typeof MediaRecorder === "undefined") return;
    const clone = track.clone();
    const recorder = new MediaRecorder(new MediaStream([clone]));
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => parts.push(e.data);
    recorder.onstop = () => {
      running.current = null;
      clone.stop();
      setLeft(null);
      setUrl(URL.createObjectURL(new Blob(parts, { type: recorder.mimeType })));
    };
    recorder.start();
    setUrl(null);
    setLeft(SAMPLE_SECONDS);
    let n = SAMPLE_SECONDS;
    const tick = setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) {
        clearInterval(tick);
        recorder.stop();
      }
    }, 1000);
    running.current = { tick, recorder, clone };
  }

  return (
    <div data-testid="hear-yourself" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Hear yourself</span>
          <span style={{ fontSize: 13.5, color: "#5f6470" }}>Record {SAMPLE_SECONDS} seconds and play it back. It stays on this page.</span>
        </span>
        <button type="button" onClick={record} disabled={left !== null} style={secondary}>
          {left !== null ? `Recording… ${left}` : url ? "Record again" : "Record a test"}
        </button>
      </div>
      {url && <audio src={url} controls autoPlay style={{ width: "100%" }} />}
    </div>
  );
}

function DevicePicker({ label, devices, value, onPick }: { label: string; devices: MediaDeviceInfo[]; value: string; onPick: (id: string) => void }) {
  if (devices.length === 0) return null;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 500 }}>
      {label}
      <select value={value} onChange={(e) => onPick(e.target.value)} style={{ height: 40, borderRadius: 10, border: "1px solid #e4e4e7", padding: "0 10px", fontSize: 14, background: "#fff", color: "#0b0b0f" }}>
        <option value="">System default</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 18, border: "1px solid #e4e4e7", borderRadius: 20, padding: 28, background: "#fff", scrollMarginTop: 80 };
const h2: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: "-.02em" };
const desc: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.55, color: "#5f6470" };
const ring: CSSProperties = { position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #e8553d" };
const secondary: CSSProperties = { cursor: "pointer", height: 36, padding: "0 14px", borderRadius: 10, border: "1px solid #e4e4e7", background: "#fff", color: "#0b0b0f", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" };
