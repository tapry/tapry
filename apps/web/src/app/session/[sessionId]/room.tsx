"use client";

import type { UploadProgress } from "@tapry/recorder";
import { STALE_REPORT_MS, type OwnRecordings, type SessionState, type SessionTicket } from "@tapry/shared";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, cn, Notice, StatusDot } from "@/components/ui";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { useCall, type CallStatus } from "@/lib/client/call";
import { localNow } from "@/lib/client/clock";
import { alertAdvice, alertLabel, talkNudge, talkShares, useQualityAlerts } from "@/lib/client/quality";
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

  const quality = useQualityAlerts({
    ticket,
    stream: ready.stream,
    upload,
    micMuted,
    headphones: ready.choice.headphones,
    recorderError,
    clockOffsetMs: ready.clock?.offsetMs ?? 0,
    callAudio: call.peers.flatMap((p) => (p.audio ? [p.audio.mediaStreamTrack] : [])),
    recordingId: recording?.id ?? null,
    active: !ended,
  });
  const advice = quality.alerts.map((a) => alertAdvice(a, quality.uploadBehindS)).filter((x): x is string => !!x);
  const shares = isHost && state?.recording ? talkShares(state.health, state.recording.id) : null;
  const nudge = isHost && recording && state ? talkNudge(state.health, recording.id, ticket.participantId) : null;

  const [panelOpen, setPanelOpen] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const lastRecording = state?.recording ?? null;

  function toggleMute() {
    setMicMuted(!micMuted);
    void call.setMicMuted(!micMuted);
  }

  // Keyboard shortcuts (⌘ on Mac, Ctrl elsewhere, plus Shift): R record/stop, M mute, L copy invite link.
  const shortcut = useRef<(key: string) => boolean>(() => false);
  shortcut.current = (key) => {
    if (ended) return false;
    if (key === "m") {
      toggleMute();
      setFlash(micMuted ? "Unmuted" : "Muted");
      return true;
    }
    if (!isHost || !state) return false;
    if (key === "r") {
      if (busy || (!recording && connection !== "live")) return true;
      void (recording ? hostAction(`/recordings/${recording.id}/stop`) : hostAction("/recordings"));
      setFlash(recording ? "Recording stopped" : "Recording started");
      return true;
    }
    if (key === "l") {
      void copyInviteLink(state.session.studioId).then((ok) => setFlash(ok ? "Invite link copied" : "Couldn't copy the invite link"));
      return true;
    }
    return false;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (shortcut.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(id);
  }, [flash]);

  return (
    <div className="flex min-h-dvh flex-col p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 pt-1.5 pb-3.5">
        <span className="flex min-w-0 flex-wrap items-center gap-3 text-base font-semibold">
          <span className="truncate">{ticket.studio.name}</span>
          <RecPill startedAt={recording?.startedAt ?? null} offsetMs={ready.clock?.offsetMs ?? 0} />
        </span>
        <span className="flex items-center gap-2.5">
          {isHost && state && !ended && <InviteButton studioId={state.session.studioId} />}
          <Avatar name={selfName} className="size-[34px] text-xs" />
        </span>
      </div>

      <div className="flex flex-col gap-2 px-2.5 pb-3 empty:hidden">
        {connection === "unauthorized" && (
          <Notice tone="danger">Your access to this session has ended. Open your invite link again to rejoin.</Notice>
        )}
        {!durable && (
          <Notice tone="warn">
            This browser blocks local storage (private window?), so your recording can&apos;t survive a crash. Keep this tab
            open until the upload finishes.
          </Notice>
        )}
        {recorderError && <Notice tone="danger">Recording problem: {recorderError}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      {ended ? (
        <EndedView
          ticket={ticket}
          isHost={isHost}
          selfName={selfName}
          studioId={state?.session.studioId ?? null}
          participants={state?.participants ?? []}
          uploads={lastRecording ? state!.uploads : []}
          upload={upload}
          finishing={localActive}
        />
      ) : (
        <div className={cn("grid min-h-0 flex-1 gap-2.5", panelOpen && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
          <div className="flex min-w-0 flex-col rounded-[18px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,.05)]">
            <div className="flex flex-1 flex-col justify-center p-[clamp(14px,2.4vw,28px)]">
              <CallGrid
                stream={ready.stream}
                selfName={selfName}
                selfMicMuted={micMuted}
                selfCameraOff={cameraOff}
                selfSpeaking={call.localSpeaking}
                peers={call.peers}
                recording={!!recording}
              />
            </div>
            {(advice.length > 0 || nudge) && (
              <div className="mx-[clamp(14px,2.4vw,28px)] mb-3 flex flex-col gap-1.5" data-testid="own-alerts">
                {advice.map((text) => (
                  <Notice key={text} tone="warn">
                    {text}
                  </Notice>
                ))}
                {nudge && (
                  <div data-testid="talk-nudge">
                    <Notice tone="info">{nudge}</Notice>
                  </div>
                )}
              </div>
            )}
            <div className="mx-[clamp(14px,2.4vw,28px)] border-t border-border" />
            <div className="flex flex-wrap items-start justify-center gap-3 px-[clamp(10px,2vw,24px)] pt-3.5 pb-[18px]">
              {isHost && (
                <ToolButton
                  label={recording ? "Recording" : "Start"}
                  aria-label={recording ? "Stop recording" : "Record"}
                  disabled={busy || (!recording && connection !== "live")}
                  title="Start or stop recording (⌘⇧R / Ctrl+Shift+R)"
                  onClick={() => (recording ? hostAction(`/recordings/${recording.id}/stop`) : hostAction("/recordings"))}
                  wide
                  icon={
                    <span className={cn("flex h-[42px] items-center gap-[9px] rounded-[10px] px-4 text-[15px] font-semibold text-white", recording ? "bg-[#2b2424]" : "bg-accent")}>
                      <span className={cn("grid size-3.5 place-items-center border-2 border-white", recording ? "rounded-[3px]" : "rounded-full")}>
                        <span className={cn("size-1.5 bg-white", recording ? "rounded-[1px]" : "rounded-full")} />
                      </span>
                      {recording ? "Stop" : "Record"}
                    </span>
                  }
                />
              )}
              <ToolButton
                label={micMuted ? "Unmute" : "Mute"}
                active={micMuted}
                aria-pressed={micMuted}
                onClick={toggleMute}
                title="Mute or unmute (⌘⇧M / Ctrl+Shift+M)"
                icon={<Icon d={micMuted ? ICONS.micOff : ICONS.mic} />}
              />
              {hasCamera && (
                <ToolButton
                  label={cameraOff ? "Camera on" : "Camera"}
                  aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                  active={cameraOff}
                  aria-pressed={cameraOff}
                  onClick={() => {
                    setCameraOff(!cameraOff);
                    void call.setCameraOff(!cameraOff);
                  }}
                  icon={<Icon d={cameraOff ? ICONS.camOff : ICONS.cam} />}
                />
              )}
              <ToolButton
                label="People"
                aria-pressed={panelOpen}
                inverted={panelOpen}
                onClick={() => setPanelOpen(!panelOpen)}
                icon={<Icon d={ICONS.people} />}
              />
            </div>
            <div className="flex flex-col items-center gap-2 px-4 pb-4 text-center">
              {flash && (
                <p role="status" className="rounded-full bg-ink px-3.5 py-1.5 text-sm font-medium text-ink-text" data-testid="shortcut-flash">
                  {flash}
                </p>
              )}
              {call.audioBlocked && call.peers.length > 0 && (
                <Button variant="primary" onClick={call.startAudio}>
                  Click to hear the others
                </Button>
              )}
              {!isHost && (
                <p className="text-sm font-medium text-text-2">
                  {recording ? "You're being recorded." : "Waiting for the host to start recording."}
                </p>
              )}
              {micMuted && recording && (
                <p className="text-sm text-warn-strong">You&apos;re muted: your microphone is silent in the recording too.</p>
              )}
              <LocalUploadStatus recording={!!recording} finishing={!recording && localActive} upload={upload} offsetMs={ready.clock?.offsetMs ?? 0} />
              <div className="flex flex-wrap justify-center gap-x-4">
                <ConnectionLabel status={connection} />
                <CallLabel status={call.status} />
              </div>
            </div>
          </div>

          {panelOpen && (
            <aside className="flex min-w-0 flex-col gap-4 rounded-[18px] bg-surface p-5 shadow-[0_1px_3px_rgba(0,0,0,.05)]">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">In the studio</h2>
                {present && (
                  <span className="text-[13px] text-subtle">
                    {state?.participants.filter((p) => present.has(p.id)).length ?? 0} of {state?.participants.length ?? 0} connected
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-3">
                {state?.participants.map((p) => {
                  const away = present && !present.has(p.id);
                  return (
                    <li key={p.id} className="flex items-center gap-3" data-testid="participant">
                      <Avatar name={p.displayName} className={cn("size-9 text-[13px]", away && "opacity-50 grayscale")} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {p.displayName}
                          {p.id === ticket.participantId && <span className="font-normal text-muted"> (you)</span>}
                          {p.role === "host" && <span className="text-xs font-normal text-muted"> · host</span>}
                        </span>
                        {shares && <TalkShare share={shares.get(p.id) ?? 0} />}
                        {isHost && (
                          <HealthChips
                            health={state.health.find((h) => h.participantId === p.id)}
                            offsetMs={ready.clock?.offsetMs ?? 0}
                          />
                        )}
                        {isHost && state.recording ? (
                          <ParticipantUpload
                            upload={state.uploads.find((u) => u.participantId === p.id)}
                            stopped={state.recording.status === "stopped"}
                            away={!!away}
                          />
                        ) : (
                          present && (
                            <span className={cn("text-xs", away ? "text-warn-strong" : "text-muted")} title={away ? "Not connected" : "In the call"}>
                              {away ? "Not connected" : "In the call"}
                            </span>
                          )
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {isHost && (
                <div className="mt-auto flex flex-col gap-3">
                  <Button
                    variant="danger"
                    className="h-11 w-full rounded-[10px] border-accent-line text-sm"
                    disabled={busy}
                    onClick={() => confirm("End the session for everyone?") && hostAction("/end")}
                  >
                    End session for everyone
                  </Button>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

const ICONS = {
  mic: "M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1 -6 0zM5 11a7 7 0 0 0 14 0M12 18v3",
  micOff: "M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V4a3 3 0 0 0 -5.9 -.7M5 11a7 7 0 0 0 11.5 5.4M12 18v3",
  cam: "M3 7h12v10H3zM15 10l6 -3v10l-6 -3",
  camOff: "M3 3l18 18M15 10l6 -3v10l-6 -3M3 7h4M15 15v2H3V7",
  people: "M9 11a4 4 0 1 0 0 -8a4 4 0 0 0 0 8M2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0 -4 -6.3",
  invite: "M9 11a4 4 0 1 0 0 -8a4 4 0 0 0 0 8M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6",
};

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** A studio toolbar button: an icon tile with a caption underneath. */
function ToolButton({
  icon,
  label,
  active,
  inverted,
  wide,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; label: string; active?: boolean; inverted?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1.5 text-[13px] text-text-2 disabled:cursor-not-allowed disabled:opacity-50",
        !wide && "min-w-14",
        className,
      )}
      {...props}
    >
      {wide ? (
        icon
      ) : (
        <span
          className={cn(
            "grid size-[42px] place-items-center rounded-[10px] transition-colors",
            active ? "bg-accent-soft text-accent-strong" : inverted ? "bg-ink text-ink-text" : "bg-[#f2f1ef] text-text dark:bg-surface-2",
          )}
        >
          {icon}
        </span>
      )}
      {label}
    </button>
  );
}

/** One person's share of the talking in this episode (talk balance, host only). */
function TalkShare({ share }: { share: number }) {
  const percent = Math.round(share * 100);
  return (
    <span className="flex items-center gap-2 text-xs text-muted" data-testid="talk-share" data-share={percent}>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-border" aria-hidden>
        <span className="block h-full rounded-full bg-text-2" style={{ width: `${percent}%` }} />
      </span>
      {percent}% of the talking
    </span>
  );
}

/** The host's view of one person's quality alerts; "Not reporting" when their device went quiet. */
function HealthChips({ health, offsetMs }: { health: SessionState["health"][number] | undefined; offsetMs: number }) {
  const [now, setNow] = useState(localNow);
  useEffect(() => {
    const id = setInterval(() => setNow(localNow()), 5000);
    return () => clearInterval(id);
  }, []);
  if (!health) return null;
  const stale = now + offsetMs - health.reportedAt > STALE_REPORT_MS;
  const chips = stale
    ? [{ key: "stale", label: "Not reporting (offline, asleep or left?)", info: false }]
    : health.alerts.map((a) => ({ key: a, label: alertLabel(a, health.uploadBehindS), info: a === "no_headphones" }));
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1 py-0.5" data-testid="health">
      {chips.map((c) => (
        <span
          key={c.key}
          data-alert={c.key}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            c.info ? "bg-surface-2 text-muted" : "bg-warn-soft text-warn-strong",
          )}
        >
          {c.info ? c.label : `⚠ ${c.label}`}
        </span>
      ))}
    </span>
  );
}

/** Copies the show's guest link; the room doesn't know it until asked. */
async function copyInviteLink(studioId: string) {
  try {
    const { inviteCode } = await apiFetch<{ inviteCode: string }>(`/studios/${studioId}`);
    await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    return true;
  } catch {
    return false;
  }
}

function InviteButton({ studioId }: { studioId: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (await copyInviteLink(studioId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      window.open(`/shows/${studioId}`, "_blank");
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the guest link (⌘⇧L / Ctrl+Shift+L)"
      className="flex cursor-pointer items-center gap-2 rounded-[10px] bg-[#2b2424] px-4 py-[9px] text-sm font-medium whitespace-nowrap text-white"
    >
      <Icon d={ICONS.invite} />
      {copied ? "Link copied" : "Invite"}
    </button>
  );
}

/** After the session: everyone's recording still arriving, then "that's a wrap". */
function EndedView({
  ticket,
  isHost,
  selfName,
  studioId,
  participants,
  uploads,
  upload,
  finishing,
}: {
  ticket: SessionTicket;
  isHost: boolean;
  selfName: string;
  studioId: string | null;
  participants: SessionState["participants"];
  uploads: SessionState["uploads"];
  upload: UploadProgress | null;
  finishing: boolean;
}) {
  const ownSent = upload?.uploadedBytes ?? 0;
  const ownLeft = upload?.pendingBytes ?? 0;
  const ownDone = !finishing && (upload?.idle ?? true);
  const rows = isHost
    ? participants
        .map((p) => ({ p, u: uploads.find((u) => u.participantId === p.id) }))
        .filter((r) => r.u)
        .map(({ p, u }) => {
          const done = u!.tracks > 0 && u!.completeTracks === u!.tracks;
          return { name: p.displayName, done, label: done ? "Received ✓" : `still arriving · ${mb(u!.bytes)} so far`, pct: done ? 100 : 60 };
        })
    : [
        {
          name: selfName,
          done: ownDone,
          label: ownDone ? "Sent ✓" : `${mb(ownLeft)} left to send`,
          pct: ownDone ? 100 : Math.max(5, Math.round((ownSent / Math.max(1, ownSent + ownLeft)) * 100)),
        },
      ];
  const allDone = rows.every((r) => r.done);
  const title = isHost
    ? allDone
      ? "That's a wrap. Everything's here."
      : "That's a wrap!"
    : allDone
      ? `Thanks, ${selfName}. All done!`
      : `Thanks for joining, ${selfName}!`;
  const sub = isHost
    ? rows.length === 0
      ? "The session has ended. Nothing was recorded in it."
      : allDone
        ? "Every recording has arrived. Your files will be ready to download in a few minutes."
        : "Everyone's recordings are still arriving. You can close this page; they'll keep coming in."
    : allDone
      ? "Your recording has reached the host. You can close this tab now."
      : "Your recording is still being sent to the host. Please keep this tab open until it's done.";

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-12">
      <div className="flex w-full max-w-[560px] flex-col gap-[22px] rounded-3xl bg-surface p-6 shadow-[0_30px_60px_-30px_rgba(60,20,30,.3),0_0_0_1px_var(--border)] sm:p-10" data-testid="session-ended">
        <span className={cn("grid size-[60px] place-items-center rounded-full text-[26px] text-white", allDone ? "bg-ok" : "bg-accent")}>
          {allDone ? "✓" : "■"}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-[clamp(28px,3.2vw,38px)] leading-[1.08] font-bold tracking-[-.03em]">{title}</h1>
          <p className="text-base leading-normal text-muted">{sub}</p>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-col gap-3.5">
            {rows.map((r) => (
              <div key={r.name} className="flex flex-col gap-[7px]">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2.5 font-medium">
                    <Avatar name={r.name} className="size-[26px] text-[10px]" />
                    {r.name}
                  </span>
                  <span className={cn("tabular-nums", r.done ? "text-ok-strong" : "text-accent-strong")}>{r.label}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-border">
                  <div className={cn("h-full rounded-full transition-[width] duration-300", r.done ? "bg-ok" : "animate-rec-pulse bg-accent")} style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {isHost && studioId && (
          <a
            href={`/shows/${studioId}`}
            className={cn("flex h-[54px] items-center justify-center rounded-xl text-[17px] font-semibold text-white hover:opacity-90", allDone ? "bg-accent" : "bg-[#2b2424]")}
          >
            Go to your show
          </a>
        )}
        {!isHost && (
          <Notice tone={allDone ? "ok" : "warn"}>
            {allDone
              ? "You're free to go. The host has everything they need."
              : "Closed it by accident? Just open the invite link again and the rest will be sent."}
          </Notice>
        )}
        {/* Only once their upload is done: nothing should compete with "keep this tab open". */}
        {!isHost && allDone && <GuestAfterwards ticket={ticket} />}
      </div>
    </div>
  );
}

const READY_POLL_MS = 5_000;
/** Download links are signed for an hour: fetch fresh ones well before that. */
const LINKS_REFRESH_MS = 30 * 60_000;

/**
 * The guest's own recording once it's processed (if the show allows it), and the "record your
 * own" link (if the server sets one).
 */
function GuestAfterwards({ ticket }: { ticket: SessionTicket }) {
  const [own, setOwn] = useState<OwnRecordings | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let next = READY_POLL_MS;
      try {
        const got = await apiFetch<OwnRecordings>(`/sessions/${ticket.sessionId}/my-recordings`, { token: ticket.token });
        if (cancelled) return;
        setOwn(got);
        if (got.recordings.every((r) => r.processing === "ready" || r.processing === "failed")) next = LINKS_REFRESH_MS;
      } catch {
        // Offline for a moment: try again on the next round.
      }
      if (!cancelled) timer = setTimeout(load, next);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticket]);
  if (!own) return null;
  const several = own.recordings.length > 1;

  return (
    <>
      {own.downloads && own.recordings.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-5" data-testid="own-recording">
          <h2 className="text-[17px] font-semibold">Your recording</h2>
          {own.recordings.map((r) => (
            <div key={r.number} className="flex flex-col gap-2">
              {several && <span className="text-sm text-muted">Episode {r.number}</span>}
              {r.processing === "ready" && r.files.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {r.files.map((f) => (
                    <a
                      key={f.url}
                      href={f.url}
                      data-file-name={f.fileName}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium hover:border-muted"
                    >
                      {f.kind === "audio" ? "∿ Your audio" : "▶ Your video"}
                      <span className="font-normal text-muted">
                        {f.fileName.split(".").pop()!.toUpperCase()} · {mb(f.bytes)}
                      </span>
                    </a>
                  ))}
                </div>
              ) : r.processing === "failed" ? (
                <p className="text-sm text-muted">Your file couldn&apos;t be prepared here. The host has your recording.</p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <StatusDot tone="warn" className="animate-rec-pulse" />
                  Getting your file ready. Takes a few minutes; keep this page open to download it.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {own.promoUrl && (
        <a
          href={own.promoUrl}
          target="_blank"
          rel="noopener"
          className="flex flex-col gap-1 rounded-2xl bg-accent-soft px-5 py-4 hover:opacity-90"
          data-testid="promo"
        >
          <span className="text-[15px] font-semibold text-accent-strong">Record your own, free →</span>
          <span className="text-sm text-text-2">
            Podcasts and interviews in full quality, everyone recorded on their own computer. Open source, and you can run it
            yourself.
          </span>
        </a>
      )}
    </>
  );
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

function LocalUploadStatus({
  recording,
  finishing,
  upload,
  offsetMs,
}: {
  /** Server time minus this device's clock: upload timestamps are in server time. */
  offsetMs: number;
  recording: boolean;
  /** Stopped on the server, but this device's recorders are still handing over their last chunk. */
  finishing: boolean;
  upload: UploadProgress | null;
}) {
  if (!upload || (!recording && !finishing && upload.uploadedChunks === 0 && upload.idle)) return null;
  const behindS = upload.oldestPendingTs !== null ? Math.round((localNow() + offsetMs - upload.oldestPendingTs) / 1000) : 0;
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
  away,
}: {
  upload: SessionState["uploads"][number] | undefined;
  stopped: boolean;
  away: boolean;
}) {
  if (!upload) return <span className="text-xs text-muted">{stopped ? "Nothing recorded" : "Starting…"}</span>;
  const done = upload.tracks > 0 && upload.completeTracks === upload.tracks;
  const text = done
    ? `✓ Uploaded · ${mb(upload.bytes)}`
    : away
      ? `Offline. Recording is safe on their computer · ${mb(upload.bytes)} sent`
      : `${stopped ? "Uploading" : "Recording"} · ${mb(upload.bytes)} sent`;
  return (
    <span className={cn("text-xs", done ? "text-ok-strong" : away ? "text-warn-strong" : "text-muted")} data-testid="participant-upload">
      {text}
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

/** "REC 12:04" while recording, "Not recording" otherwise. */
function RecPill({ startedAt, offsetMs }: { startedAt: number | null; offsetMs: number }) {
  const [now, setNow] = useState(localNow);
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(localNow()), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) {
    return (
      <span className="inline-flex items-center gap-[7px] rounded-full bg-[#efeeec] px-[11px] py-[5px] font-mono text-xs font-medium text-muted dark:bg-surface-2">
        <span aria-hidden className="size-[7px] rounded-full bg-current" /> Not recording
      </span>
    );
  }
  const s = Math.max(0, Math.floor((now + offsetMs - startedAt) / 1000));
  const text = `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <span className="inline-flex items-center gap-[7px] rounded-full bg-accent-soft px-[11px] py-[5px] font-mono text-xs font-medium text-accent-strong">
      <span aria-hidden className="size-[7px] animate-rec-pulse rounded-full bg-current" /> REC {text}
    </span>
  );
}
