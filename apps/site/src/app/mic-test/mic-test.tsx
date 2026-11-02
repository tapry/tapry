"use client";

// The free mic & camera test: everything happens in the visitor's browser, nothing is sent
// anywhere. The level thresholds are the app's green room's (apps/web/src/lib/media/media.ts,
// classifyLevel), so "sounds good" here means the same as in a Tapry studio.
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Level = "silent" | "quiet" | "good" | "loud";
const ADVICE: Record<Level, string> = {
  silent: "We can’t hear anything. Say something, or pick another microphone.",
  quiet: "A bit quiet. Move closer to the mic or turn up its input level.",
  good: "Sounds good.",
  loud: "Too loud: the sound is distorting. Move back a little or lower the input level.",
};
const LEVEL_COLOR: Record<Level, string> = { silent: "#c8c8cc", quiet: "#e0a019", good: "#1f9d55", loud: "#e8553d" };
const SAMPLE_SECONDS = 5;
/** Headsets whose mic uses the Bluetooth call profile: narrowband, sounds like a phone. */
const BLUETOOTH = /airpods|bluetooth|hands-?free|headset|buds|bose|jabra|beats|wh-1000/i;

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -100);

function classify(loudestRmsDb: number, peakDb: number): Level {
  if (peakDb > -1) return "loud";
  if (loudestRmsDb < -60) return "silent";
  if (loudestRmsDb < -38) return "quiet";
  return "good";
}

export function MicTest() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [withCamera, setWithCamera] = useState(true);
  const started = stream !== null || error !== null;

  async function start(mic = micId, cam = camId, camera = withCamera) {
    setError(null);
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
            ? "No microphone or camera found. Plug one in, or turn the camera off below."
            : name === "NotReadableError"
              ? "Another app is using your microphone or camera. Close it (Zoom, Teams, FaceTime…) and try again."
              : "Couldn’t open your microphone or camera. Try again, or try another browser.",
      );
    }
  }
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  const audio = stream?.getAudioTracks()[0] ?? null;
  const video = stream?.getVideoTracks()[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!started && (
        <div style={{ ...card, alignItems: "center", textAlign: "center", padding: "48px 28px", gap: 18 }}>
          <span style={{ fontSize: 17, color: "#6e6e73", maxWidth: 520 }}>
            Your browser will ask to use your microphone and camera. Nothing is recorded or sent anywhere: the test runs on this
            page only.
          </span>
          <button type="button" className="cta" onClick={() => start()} style={primaryButton}>
            Test my mic and camera
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: "#6e6e73" }}>
            <input type="checkbox" checked={!withCamera} onChange={(e) => setWithCamera(!e.target.checked)} />
            Microphone only
          </label>
        </div>
      )}

      {error && (
        <div role="alert" style={{ ...card, background: "#fdece8", color: "#a3321f", gap: 12 }}>
          {error}
          <button type="button" onClick={() => start()} style={{ ...secondaryButton, alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      )}

      {stream && (
        <div className="mic-test-grid" style={{ display: "grid", gap: 20, gridTemplateColumns: video ? "minmax(0,1.3fr) minmax(0,1fr)" : "minmax(0,1fr)" }}>
          {video && <CameraPanel track={video} stream={stream} cams={cams} camId={camId} onPick={(id) => (setCamId(id), start(micId, id))} />}
          <MicPanel track={audio} stream={stream} mics={mics} micId={micId} onPick={(id) => (setMicId(id), start(id, camId))} />
        </div>
      )}
    </div>
  );
}

function MicPanel({
  track,
  stream,
  mics,
  micId,
  onPick,
}: {
  track: MediaStreamTrack | null;
  stream: MediaStream;
  mics: MediaDeviceInfo[];
  micId: string;
  onPick: (id: string) => void;
}) {
  const [meter, setMeter] = useState({ rmsDb: -100, level: "silent" as Level });
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    if (!track) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    void ctx.resume();
    const buf = new Float32Array(analyser.fftSize);
    const history: Array<{ t: number; rms: number; peak: number }> = [];
    let shown = -100;
    let last = performance.now();
    const id = setInterval(() => {
      setSuspended(ctx.state !== "running");
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
      const loudest = Math.max(...history.map((h) => h.rms));
      const peakDb = Math.max(...history.map((h) => h.peak));
      setMeter({ rmsDb: shown, level: classify(loudest, peakDb) });
    }, 50);
    return () => {
      clearInterval(id);
      void ctx.close();
    };
  }, [track]);

  const settings = track?.getSettings();
  const label = track?.label ?? "";
  const bluetooth = BLUETOOTH.test(label) || (!!settings?.sampleRate && settings.sampleRate <= 16_000);
  const fraction = Math.min(1, Math.max(0, (meter.rmsDb + 60) / 60));

  return (
    <div style={{ ...card, gap: 18 }} data-testid="mic-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={h2}>Microphone</h2>
        <span style={{ fontSize: 15, fontWeight: 500, color: LEVEL_COLOR[meter.level] === "#c8c8cc" ? "#6e6e73" : LEVEL_COLOR[meter.level] }} data-testid="mic-advice" data-level={meter.level}>
          {suspended ? "Click anywhere to start the meter" : ADVICE[meter.level]}
        </span>
      </div>
      <div role="meter" aria-label="Microphone level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(Math.max(-60, meter.rmsDb))} style={{ height: 12, borderRadius: 999, background: "#ececef", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${fraction * 100}%`, borderRadius: 999, background: LEVEL_COLOR[meter.level], transition: "width 60ms linear" }} />
      </div>
      <span style={{ fontSize: 14, color: "#8e8e93" }}>Talk at your normal volume. The bar should sit in the middle and turn green.</span>

      <DevicePicker label="Microphone" devices={mics} value={micId || mics.find((d) => d.label === label)?.deviceId || ""} onPick={onPick} kind="Microphone" />

      <dl style={details}>
        <Detail name="Device" value={label || "Unknown"} />
        {settings?.sampleRate && <Detail name="Sample rate" value={`${(settings.sampleRate / 1000).toFixed(1)} kHz`} />}
        {settings?.channelCount && <Detail name="Channels" value={settings.channelCount === 1 ? "Mono" : settings.channelCount === 2 ? "Stereo" : `${settings.channelCount} channels`} />}
      </dl>
      {bluetooth && (
        <p style={{ ...note, background: "#fff4dc", color: "#8a5a0c" }} data-testid="bluetooth-note">
          This looks like a Bluetooth headset’s microphone. When a headset’s mic is on, Bluetooth switches to its call mode and
          you sound like a phone call. Keep the headphones for listening, and speak into your computer’s microphone or a USB mic.
        </p>
      )}
      <HearYourself stream={stream} />
    </div>
  );
}

function HearYourself({ stream }: { stream: MediaStream }) {
  const [left, setLeft] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  function record() {
    const track = stream.getAudioTracks()[0];
    if (!track || typeof MediaRecorder === "undefined") return;
    const clone = track.clone();
    const recorder = new MediaRecorder(new MediaStream([clone]));
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => parts.push(e.data);
    recorder.onstop = () => {
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
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid #ececef", paddingTop: 18 }} data-testid="hear-yourself">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600 }}>Hear yourself</span>
          <span style={{ fontSize: 14, color: "#8e8e93" }}>Record {SAMPLE_SECONDS} seconds and play it back. It stays on this page.</span>
        </span>
        <button type="button" onClick={record} disabled={left !== null} style={secondaryButton}>
          {left !== null ? `Recording… ${left}` : url ? "Record again" : "Record a test"}
        </button>
      </div>
      {url && <audio src={url} controls autoPlay style={{ width: "100%" }} />}
    </div>
  );
}

function CameraPanel({
  track,
  stream,
  cams,
  camId,
  onPick,
}: {
  track: MediaStreamTrack;
  stream: MediaStream;
  cams: MediaDeviceInfo[];
  camId: string;
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; fps?: number } | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const s = track.getSettings();
  const height = size?.h ?? s.height;
  const quality = !height ? null : height >= 1080 ? "Full HD" : height >= 720 ? "HD" : "Low resolution";

  return (
    <div style={{ ...card, gap: 16 }} data-testid="camera-panel">
      <h2 style={h2}>Camera</h2>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, fps: s.frameRate })}
        style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 16, background: "#1d1d1f", transform: "scaleX(-1)" }}
      />
      <DevicePicker label="Camera" devices={cams} value={camId || cams.find((d) => d.label === track.label)?.deviceId || ""} onPick={onPick} kind="Camera" />
      <dl style={details}>
        <Detail name="Device" value={track.label || "Unknown"} />
        {height && <Detail name="Resolution" value={`${size?.w ?? s.width}×${height}${quality ? ` (${quality})` : ""}`} />}
        {s.frameRate && <Detail name="Frame rate" value={`${Math.round(s.frameRate)} fps`} />}
      </dl>
      {height !== undefined && height < 720 && (
        <p style={{ ...note, background: "#fff4dc", color: "#8a5a0c" }}>
          Your camera gives less than HD. Check its settings, close other apps using it, or try another camera.
        </p>
      )}
    </div>
  );
}

function DevicePicker({ label, devices, value, onPick, kind }: { label: string; devices: MediaDeviceInfo[]; value: string; onPick: (id: string) => void; kind: string }) {
  if (devices.length === 0) return null;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 15, fontWeight: 500 }}>
      {label}
      <select value={value} onChange={(e) => onPick(e.target.value)} style={{ height: 46, borderRadius: 12, border: "1px solid #e2e2e5", padding: "0 12px", font: "400 15px var(--sans)", background: "#ffffff", color: "#1d1d1f" }}>
        <option value="">System default</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${kind} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function Detail({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt style={{ color: "#8e8e93" }}>{name}</dt>
      <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
    </>
  );
}

const card: CSSProperties = { display: "flex", flexDirection: "column", borderRadius: 22, background: "#ffffff", padding: 26, boxShadow: "0 0 0 1px #ececef, 0 10px 30px -18px rgba(0,0,0,.18)" };
const h2: CSSProperties = { margin: 0, fontSize: 21, fontWeight: 650, letterSpacing: "-.01em" };
const details: CSSProperties = { margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 18px", fontSize: 14 };
const note: CSSProperties = { margin: 0, borderRadius: 12, padding: "12px 14px", fontSize: 14, lineHeight: 1.5 };
const primaryButton: CSSProperties = { cursor: "pointer", border: 0, padding: "18px 30px", borderRadius: 14, background: "#e8553d", color: "#ffffff", font: "600 18px var(--sans)", boxShadow: "0 10px 24px -10px rgba(232,85,61,.7)" };
const secondaryButton: CSSProperties = { cursor: "pointer", height: 44, padding: "0 18px", borderRadius: 999, border: "1px solid #e2e2e5", background: "#ffffff", color: "#1d1d1f", font: "500 15px var(--sans)", whiteSpace: "nowrap" };
