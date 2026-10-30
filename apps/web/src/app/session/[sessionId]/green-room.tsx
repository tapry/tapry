"use client";

import { checkStorage, requestPersistentStorage } from "@opentake/recorder";
import type { SessionTicket } from "@opentake/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, cn, Field, Notice, Select, StatusDot } from "@/components/ui";
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
    // Ask the browser not to evict the local backup under disk pressure (Firefox shows a prompt).
    await requestPersistentStorage().catch(() => false);
    // The room owns the stream from here; the green room must not stop it on unmount.
    onJoin({ stream: handOff() ?? stream, choice, clock });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
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

      <Card className="space-y-5">
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

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={choice.headphones}
            onChange={(e) => setChoice({ ...choice, headphones: e.target.checked })}
          />
          <span>
            <span className="font-medium">I'm wearing headphones</span>
            <span className="block text-muted">
              Strongly recommended. Without them, the other voices leak into your microphone.
            </span>
          </span>
        </label>

        <ul className="space-y-2 border-t border-border pt-4 text-sm" aria-label="Checks">
          {checks.length === 0 && <li className="text-muted">Checking your browser…</li>}
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className="pt-1.5">
                <StatusDot tone={c.tone} />
              </span>
              <span className={c.tone === "ok" ? "text-muted" : undefined}>{c.label}</span>
            </li>
          ))}
        </ul>

        <Button variant="record" className="w-full" disabled={!canJoin} onClick={join}>
          {ticket.role === "host" ? "Enter the studio" : "Join the studio"}
        </Button>
        {status === "live" && level.state !== "good" && (
          <p className="text-center text-xs text-muted">You can join anyway, but check the mic warning first.</p>
        )}
      </Card>
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
    <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-surface-2">
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className={cn("size-full -scale-x-100 object-cover", !hasVideo && "invisible")}
      />
      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">
          {cameraOff ? "Camera off" : stream ? "No camera" : failed ? "Camera unavailable" : "Starting camera…"}
        </div>
      )}
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
  const color = state === "clipping" ? "bg-danger" : state === "good" ? "bg-ok" : "bg-warn";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Microphone level</span>
        {live && <span className="text-muted">{suspended ? "Click anywhere to start the meter" : LEVEL_ADVICE[state]}</span>}
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={Math.round(Math.max(-60, db))}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-75", color)} style={{ width: `${meterFraction(db) * 100}%` }} />
      </div>
    </div>
  );
}
