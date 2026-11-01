"use client";

import { checkStorage, requestPersistentStorage } from "@tapry/recorder";
import type { SessionTicket } from "@tapry/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, CheckboxRow, cn, Field, Notice, RecDot, Select } from "@/components/ui";
import { apiFetch } from "@/lib/client/api";
import { estimateClock, type ClockEstimate } from "@/lib/client/clock";
import { useDevices, useLocalMedia, useMicLevel, useStoredState } from "@/lib/media/hooks";
import {
  browserChecks,
  buildConstraints,
  currentBrowserEnv,
  LEVEL_ADVICE,
  looksLikeHeadphones,
  meterFraction,
  networkCheck,
  storageCheck,
  type Check,
  type DeviceChoice,
} from "@/lib/media/media";

export interface ReadyToJoin {
  stream: MediaStream;
  choice: DeviceChoice;
  clock: ClockEstimate | null;
}

/**
 * Check camera, mic and browser before entering. The stream opened here is handed
 * to the room as-is, so guests don't see a second permission prompt or a flicker.
 */
export function GreenRoom({ ticket, onJoin }: { ticket: SessionTicket; onJoin: (ready: ReadyToJoin) => void }) {
  const settings = ticket.studio.settings;
  // Key named before the rename to Tapry, so saved device choices carry over.
  const [choice, setChoice] = useStoredState<DeviceChoice>("opentake:devices", { headphones: false });
  const constraints = useMemo(() => buildConstraints(settings, choice), [settings, choice]);
  const { stream, status, problem, retry, handOff } = useLocalMedia(constraints);
  const devices = useDevices(status); // re-list once permission makes labels visible
  const level = useMicLevel(stream);
  const [checks, setChecks] = useState<Check[]>([]);
  const [clock, setClock] = useState<ClockEstimate | null>(null);
  const [joining, setJoining] = useState(false);

  // Headphones: pre-tick when the default output looks like a headset. Guests can untick.
  const detected = useRef(false);
  useEffect(() => {
    if (detected.current || devices.audioOutputs.length === 0) return;
    detected.current = true;
    const output = devices.audioOutputs.find((d) => d.deviceId === "default") ?? devices.audioOutputs[0];
    if (looksLikeHeadphones(output?.label) && !choice.headphones) setChoice({ ...choice, headphones: true });
  }, [devices.audioOutputs, choice, setChoice]);

  useEffect(() => {
    let cancelled = false;
    const base = browserChecks(currentBrowserEnv());
    setChecks(base);
    (async () => {
      const disk = await checkStorage().catch(() => null);
      const est = await estimateClock(async () => (await apiFetch<{ serverTime: number }>("/time")).serverTime).catch(
        () => null,
      );
      if (cancelled) return;
      setClock(est);
      setChecks([...base, storageCheck(disk?.freeBytes ?? null, disk?.ok ?? true), networkCheck(est?.rttMs ?? null)]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const blocking = checks.some((c) => c.tone === "danger");
  const canJoin = status === "live" && !!stream && !blocking && !joining;

  async function join() {
    if (!stream) return;
    setJoining(true);
    // Ask the browser not to evict the local backup under disk pressure. Never wait for the
    // answer: Firefox shows a prompt and the promise stays pending until the guest responds,
    // which would block joining for anyone who ignores it.
    void requestPersistentStorage().catch(() => false);
    // The room owns the stream from here; the green room must not stop it on unmount.
    onJoin({ stream: handOff() ?? stream, choice, clock });
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-3.5">
        <Preview stream={stream} cameraOff={!!choice.cameraOff} failed={status === "error"} />
        <MicMeter db={level.rmsDb} state={level.state} live={status === "live"} suspended={level.suspended} />
        {problem && (
          <Notice tone="danger">
            <p className="font-medium">{problem.title}</p>
            <p className="mt-1">{problem.help}</p>
            <Button variant="secondary" className="mt-3" onClick={retry}>
              Try again
            </Button>
          </Notice>
        )}
      </div>

      <div className="flex flex-col gap-[18px] rounded-[20px] bg-surface p-6">
        <Field label="Microphone">
          <Select
            value={choice.audioDeviceId ?? ""}
            onChange={(e) => setChoice({ ...choice, audioDeviceId: e.target.value || undefined })}
          >
            <option value="">System default</option>
            {devices.audioInputs
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Camera">
          <Select
            value={choice.cameraOff ? "off" : (choice.videoDeviceId ?? "")}
            onChange={(e) =>
              setChoice({
                ...choice,
                cameraOff: e.target.value === "off",
                videoDeviceId: e.target.value && e.target.value !== "off" ? e.target.value : undefined,
              })
            }
          >
            <option value="">System default</option>
            {devices.videoInputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
            <option value="off">Camera off (audio only)</option>
          </Select>
        </Field>

        <CheckboxRow
          checked={choice.headphones}
          onChange={(e) => setChoice({ ...choice, headphones: e.target.checked })}
          label="I'm wearing headphones"
          description="Highly recommended. Without them, other people's voices can leak into your microphone."
        />

        <ul className="flex flex-col gap-2.5 border-t border-border pt-4 text-sm" aria-label="Checks">
          {checks.length === 0 && <li className="text-muted">Checking your browser…</li>}
          {checks.map((c) => (
            <li key={c.id} className={cn("flex items-start gap-2.5", c.tone === "ok" ? "text-text-2" : "text-warn-strong")}>
              <span
                aria-hidden
                className={cn(
                  "mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px]",
                  c.tone === "ok" ? "bg-ok-soft text-ok-strong" : c.tone === "warn" ? "bg-warn-soft" : "bg-accent-soft text-accent-strong",
                )}
              >
                {c.tone === "ok" ? "✓" : "!"}
              </span>
              {c.label}
            </li>
          ))}
        </ul>

        <Button variant="record" size="lg" className="w-full text-[17px]" disabled={!canJoin} onClick={join}>
          <RecDot />
          {ticket.role === "host" ? "Enter the studio" : "Join the studio"}
        </Button>
        {status === "live" && level.state !== "good" && (
          <p className="text-center text-xs text-muted">You can join anyway, but check the microphone first.</p>
        )}
      </div>
    </div>
  );
}

function Preview({ stream, cameraOff, failed }: { stream: MediaStream | null; cameraOff: boolean; failed: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  const hasVideo = !!stream && stream.getVideoTracks().length > 0 && !cameraOff;
  return (
    <div className="relative aspect-video overflow-hidden rounded-[20px] bg-[#ebe9e6] dark:bg-surface-2">
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className={cn("size-full -scale-x-100 object-cover", !hasVideo && "invisible")}
      />
      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-[15px] text-text-2">
          {cameraOff
            ? "Camera off. You'll be recorded with audio only"
            : stream
              ? "No camera"
              : failed
                ? "Camera unavailable"
                : "Starting camera…"}
        </div>
      )}
      <span className="absolute bottom-3 left-3 rounded-[10px] bg-[rgba(30,26,26,.72)] px-3 py-1.5 text-sm text-white">You</span>
    </div>
  );
}

function MicMeter({
  db,
  state,
  live,
  suspended,
}: {
  db: number;
  state: keyof typeof LEVEL_ADVICE;
  live: boolean;
  suspended: boolean;
}) {
  const color = state === "clipping" ? "bg-accent" : state === "good" ? "bg-ok" : "bg-warn";
  const text = state === "clipping" ? "text-accent-strong" : state === "good" ? "text-ok-strong" : "text-warn-strong";
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-surface px-[18px] py-4">
      <div className="flex items-center justify-between gap-3 text-[15px]">
        <span className="font-medium">How you sound</span>
        {live && (
          <span className={cn("text-right text-sm", suspended ? "text-muted" : text)}>
            {suspended ? "Click anywhere to start the meter" : LEVEL_ADVICE[state]}
          </span>
        )}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={Math.round(Math.max(-60, db))}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-75", color)} style={{ width: `${meterFraction(db) * 100}%` }} />
      </div>
      <span className="text-[13px] text-subtle">Say a few words. The bar should move into the middle.</span>
    </div>
  );
}
