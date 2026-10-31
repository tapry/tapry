"use client";

import type { UploadProgress } from "@opentake/recorder";
import type { SessionState, SessionTicket } from "@opentake/shared";
import { useEffect, useRef, useState } from "react";
import { Button, Card, cn, Notice, StatusDot } from "@/components/ui";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { useCall, type CallStatus } from "@/lib/client/call";
import { getPipeline, RecordingController } from "@/lib/client/recording";
import { CallGrid } from "./call-grid";
import { followSession, type ConnectionStatus } from "@/lib/client/session-events";
import type { ReadyToJoin } from "./green-room";

/**
 * The room after the green room: live session state, host controls, and this
 * participant's local recording, which follows the host's Record/Stop, beside the
 * live call. The call never affects the recording (see useCall).
 */
export function Room({ ticket, ready }: { ticket: SessionTicket; ready: ReadyToJoin }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [localActive, setLocalActive] = useState(false);
  const [durable, setDurable] = useState(true);
  const controller = useRef<RecordingController | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const ended = state?.session.status === "ended";
  const call = useCall(ticket, ready.stream, !ended);
  const hasCamera = ready.stream.getVideoTracks().length > 0;

  useEffect(() => followSession(ticket.sessionId, ticket.token, setState, setConnection), [ticket]);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    void getPipeline().then((p) => {
      if (cancelled) return;
      setDurable(p.durable);
      unsubscribe = p.subscribe(setUpload);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // One controller per stream. Stopping is deferred a tick so React's dev-mode
  // unmount/remount check doesn't stop the camera or end a running recording.
  const mounts = useRef(0);
  useEffect(() => {
    const id = ++mounts.current;
    controller.current ??= new RecordingController({
      ticket,
      stream: ready.stream,
      clockOffsetMs: ready.clock?.offsetMs ?? 0,
      onError: (err) => {
        console.error("[recording]", err);
        setRecorderError(err instanceof Error ? err.message : String(err));
      },
      onLocalActive: setLocalActive,
    });
    return () => {
      setTimeout(() => {
        if (mounts.current !== id) return;
        void controller.current?.stop();
        ready.stream.getTracks().forEach((t) => t.stop());
      }, 0);
    };
  }, [ticket, ready]);

  const recording = state?.recording?.status === "recording" ? state.recording : null;
  useEffect(() => {
    if (state) void controller.current?.sync(recording?.id ?? null);
  }, [state, recording?.id]);

  // Closing the tab now would lose what hasn't reached the server yet.
  const unsent = !!recording || localActive || (upload !== null && !upload.idle);
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const isHost = ticket.role === "host";
  const selfName = state?.participants.find((p) => p.id === ticket.participantId)?.displayName ?? "You";
  const present =
    call.status === "connected" ? new Set([ticket.participantId, ...call.peers.map((p) => p.id)]) : null;

  async function hostAction(path: string) {
    setBusy(true);
    setError(null);
    try {
      setState(await apiFetch<SessionState>(`/sessions/${ticket.sessionId}${path}`, { body: {}, token: ticket.token }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.studio.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4">
            <ConnectionLabel status={connection} />
            <CallLabel status={call.status} />
          </div>
        </div>
        {recording && <RecordingBadge startedAt={recording.startedAt} offsetMs={ready.clock?.offsetMs ?? 0} />}
      </div>

      {connection === "unauthorized" && (
        <Notice tone="danger">Your access to this session has ended. Open your invite link again to rejoin.</Notice>
      )}
      {ended && <Notice tone="info">The host has ended this session.</Notice>}
      {!durable && (
        <Notice tone="warn">
          This browser blocks local storage (private window?), so your recording can't survive a crash. Keep this tab
          open until the upload finishes.
        </Notice>
      )}
      {recorderError && <Notice tone="danger">Recording problem: {recorderError}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <CallGrid
            stream={ready.stream}
            selfName={selfName}
            selfMicMuted={micMuted}
            selfCameraOff={cameraOff}
            selfSpeaking={call.localSpeaking}
            peers={call.peers}
            recording={!!recording}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={micMuted ? "record" : "secondary"}
              aria-pressed={micMuted}
              onClick={() => {
                setMicMuted(!micMuted);
                void call.setMicMuted(!micMuted);
              }}
            >
              {micMuted ? "Unmute" : "Mute"}
            </Button>
            {hasCamera && (
              <Button
                variant="secondary"
                aria-pressed={cameraOff}
                onClick={() => {
                  setCameraOff(!cameraOff);
                  void call.setCameraOff(!cameraOff);
                }}
              >
                {cameraOff ? "Turn camera on" : "Turn camera off"}
              </Button>
            )}
            {call.audioBlocked && call.peers.length > 0 && (
              <Button variant="primary" onClick={call.startAudio}>
                Click to hear the others
              </Button>
            )}
          </div>
          {micMuted && recording && (
            <p className="text-sm text-warn">You're muted: your microphone is silent in the recording too.</p>
          )}
          <LocalUploadStatus recording={!!recording} finishing={!recording && localActive} upload={upload} />
        </div>

        <Card className="space-y-4">
          <h2 className="text-sm font-medium">In the studio</h2>
          <ul className="space-y-2 text-sm">
            {state?.participants.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2" data-testid="participant">
                <span className="flex items-center gap-2">
                  {/* Presence comes from the call; without one we can't tell who is still here. */}
                  {present && (
                    <span title={present.has(p.id) ? "In the call" : "Not connected"}>
                      <StatusDot tone={present.has(p.id) ? "ok" : "idle"} />
                    </span>
                  )}
                  <span className={present && !present.has(p.id) ? "text-muted" : undefined}>{p.displayName}</span>
                  {p.id === ticket.participantId && <span className="text-muted"> (you)</span>}
                  {p.role === "host" && <span className="text-xs text-muted"> · host</span>}
                </span>
                {isHost && state.recording && (
                  <ParticipantUpload
                    upload={state.uploads.find((u) => u.participantId === p.id)}
                    stopped={state.recording.status === "stopped"}
                  />
                )}
              </li>
            ))}
          </ul>

          {isHost && !ended && (
            <div className="space-y-2 border-t border-border pt-4">
              {recording ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => hostAction(`/recordings/${recording.id}/stop`)}
                >
                  Stop recording
                </Button>
              ) : (
                <Button
                  variant="record"
                  className="w-full"
                  disabled={busy || connection !== "live"}
                  onClick={() => hostAction("/recordings")}
                >
                  Record
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => confirm("End the session for everyone?") && hostAction("/end")}
              >
                End session
              </Button>
            </div>
          )}
          {!isHost && !ended && (
            <p className="border-t border-border pt-4 text-sm text-muted">
              {recording ? "You're being recorded." : "Waiting for the host to start recording."}
            </p>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </Card>
      </div>

    </div>
  );
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

function LocalUploadStatus({
  recording,
  finishing,
  upload,
}: {
  recording: boolean;
  /** Stopped on the server, but this device's recorders are still handing over their last chunk. */
  finishing: boolean;
  upload: UploadProgress | null;
}) {
  if (!upload || (!recording && !finishing && upload.uploadedChunks === 0 && upload.idle)) return null;
  const behindS = upload.oldestPendingTs !== null ? Math.round((Date.now() - upload.oldestPendingTs) / 1000) : 0;
  let tone: "ok" | "warn" | "idle" = "ok";
  let text: string;
  // Recording comes first: the queue is idle between chunks, which doesn't mean we're done.
  if (recording) {
    tone = behindS > 30 ? "warn" : "ok";
    text =
      behindS > 30
        ? `Recording on this device. Upload is ${behindS} s behind; it will catch up.`
        : `Recording on this device and uploading as you go (${mb(upload.uploadedBytes)} sent).`;
  } else if (finishing) {
    tone = "warn";
    text = "Finishing the recording on this device. Keep this tab open.";
  } else if (upload.idle) {
    text = `All of your recording is uploaded (${mb(upload.uploadedBytes)}).`;
  } else {
    tone = "warn";
    text = `Uploading your recording: ${mb(upload.pendingBytes)} left. Keep this tab open.`;
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted" role="status" data-testid="local-upload">
      <StatusDot tone={tone} /> {text}
    </p>
  );
}

function ParticipantUpload({
  upload,
  stopped,
}: {
  upload: SessionState["uploads"][number] | undefined;
  stopped: boolean;
}) {
  if (!upload) return <span className="text-xs text-muted">{stopped ? "no tracks" : "starting…"}</span>;
  const done = upload.tracks > 0 && upload.completeTracks === upload.tracks;
  return (
    <span className={cn("text-xs", done ? "text-ok" : "text-muted")} data-testid="participant-upload">
      {done ? `✓ uploaded · ${mb(upload.bytes)}` : `${stopped ? "uploading" : "recording"} · ${mb(upload.bytes)}`}
    </span>
  );
}


function CallLabel({ status }: { status: CallStatus }) {
  if (status === "off") return null;
  const map = {
    connecting: ["idle", "Call: connecting…"],
    connected: ["ok", "Call: connected"],
    reconnecting: ["warn", "Call: reconnecting… (recording continues)"],
    failed: ["danger", "Call unavailable (recording continues)"],
  } as const;
  const [tone, label] = map[status];
  return (
    <p className="flex items-center gap-2 text-sm text-muted" data-testid="call-status">
      <StatusDot tone={tone} /> {label}
    </p>
  );
}

function ConnectionLabel({ status }: { status: ConnectionStatus }) {
  const map = {
    connecting: ["idle", "Connecting…"],
    live: ["ok", "Connected"],
    reconnecting: ["warn", "Reconnecting…"],
    unauthorized: ["danger", "Disconnected"],
  } as const;
  const [tone, label] = map[status];
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <StatusDot tone={tone} /> {label}
    </p>
  );
}

function RecordingBadge({ startedAt, offsetMs }: { startedAt: number; offsetMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now + offsetMs - startedAt) / 1000));
  const text = `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-text">
      <span className="size-2 animate-pulse rounded-full bg-accent-text" /> REC {text}
    </span>
  );
}
