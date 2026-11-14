"use client";

import { isTouchDevice, keepAwake, wakeLockSupported } from "@/lib/client/wake-lock";
import { translateMaybe } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { GuidePanel } from "./guide-panel";
import type { UploadProgress } from "@tapry/recorder";
import { STALE_REPORT_MS, type OwnRecordings, type RecapStatus, type SessionState, type SessionTicket } from "@tapry/shared";
import { useEffect, useRef, useState } from "react";
import { OwnFiles } from "@/components/own-files";
import { Avatar, Button, cn, LogoMark, Notice, StatusDot } from "@/components/ui";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { mb } from "@/lib/format";
import { useCall, type CallStatus } from "@/lib/client/call";
import { localNow } from "@/lib/client/clock";
import { createFilterSync, onTrackRegistered, useFilterPrefs, type FilterSync } from "@/lib/client/filters";
import { useBackgroundBlur } from "@/lib/client/person-mask";
import { alertAdvice, alertLabel, talkNudge, talkShares, useQualityAlerts } from "@/lib/client/quality";
import { getPipeline, RecordingController } from "@/lib/client/recording";
import { CallGrid, type Layout } from "./call-grid";
import { FiltersPanel, filtersOn, useFiltersPanel } from "./filters-panel";
import { eqAnimation, Icon, ICON } from "./icons";
import { RecapEmail } from "./recap-email";
import { followSession, type ConnectionStatus } from "@/lib/client/session-events";
import { FilterDot, type ReadyToJoin } from "./green-room";

/**
 * The room after the green room: live session state, host controls, and this
 * participant's local recording, which follows the host's Record/Stop, beside the
 * live call. The call never affects the recording (see useCall).
 */
export function Room({ ticket, ready }: { ticket: SessionTicket; ready: ReadyToJoin }) {
  const { locale, t } = useT();
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
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [screenNote, setScreenNote] = useState<string | null>(null);
  const ended = state?.session.status === "ended";
  // Filters are for the call's copies, this person's own tile and the finished files. The stream
  // from the green room goes to the recorder as it is.
  const [prefs, setPrefs] = useFilterPrefs();
  const call = useCall(ticket, ready.stream, !ended && !ticket.solo, prefs.filters);
  const hasCamera = ready.stream.getVideoTracks().length > 0;
  const filtersPanel = useFiltersPanel(true);
  // Background blur: where the person is, from its own copy of the camera. The mask is drawn
  // into the call's copy and this person's tile, and recorded as a small third track; whatever
  // goes wrong with it turns blur off and never touches the camera and mic recording.
  const blur = useBackgroundBlur(hasCamera ? ready.stream : null, prefs);
  const blurGiveUp = useRef(blur.giveUp);
  blurGiveUp.current = blur.giveUp;

  // A change of filters during the session goes to the server a moment later (new tracks carry
  // theirs when they start). Never waited for; a failed send goes again with the next change.
  const filterSync = useRef<FilterSync | null>(null);
  useEffect(() => {
    const sync = createFilterSync(ticket, prefs.filters);
    filterSync.current = sync;
    // A track that reached the server late missed any change made before it: send the choice again.
    const off = onTrackRegistered((sessionId, filters) => sessionId === ticket.sessionId && sync.registered(filters));
    return () => {
      off();
      sync.stop();
    };
    // Only where it starts from: later changes come through the effect below.
  }, [ticket]);
  useEffect(() => {
    if (!ended) filterSync.current?.set(prefs.filters);
  }, [prefs.filters, ended]);

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
      onRecovered: () => setRecorderError(null),
      onLocalActive: setLocalActive,
      onMaskProblem: (err) => {
        console.warn("[recording] mask", err);
        blurGiveUp.current("recorder");
      },
      onScreenProblem: (err) => {
        console.warn("[recording] screen", err);
        setScreenNote("Your screen is shared, but it couldn't be recorded.");
      },
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
  // A producer's device records nothing: it never follows the recording.
  const producer = !!ready.producer;
  // Before following the recording, so a recording that starts now has the mask from its first moment.
  useEffect(() => {
    void controller.current?.setMask(blur.maskStream);
  }, [blur.maskStream]);
  useEffect(() => {
    if (state && !producer) void controller.current?.sync(recording?.id ?? null);
  }, [state, recording?.id, producer]);
  // The finished file is only blurred when the mask covers the recording from its start.
  const blurAtStart = useRef<{ id: string; covered: boolean } | null>(null);
  if (recording && blurAtStart.current?.id !== recording.id) blurAtStart.current = { id: recording.id, covered: blur.status === "ready" };
  if (recording && blur.status !== "ready" && blurAtStart.current) blurAtStart.current.covered = false;
  const blurLate = !!recording && !blurAtStart.current?.covered;

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

  // The screen stays on while the session runs and until everything is uploaded: a phone that
  // locks stops recording. Not a need: where the browser can't, phones get a line saying so.
  const awake = !ended || unsent;
  useEffect(() => {
    if (!awake) return;
    return keepAwake();
  }, [awake]);
  const [screenMayLock, setScreenMayLock] = useState(false);
  useEffect(() => setScreenMayLock(isTouchDevice() && !wakeLockSupported()), []);

  const isHost = ticket.role === "host";
  // Recording alone on a solo link: no call, and this person starts and stops their own recording.
  const solo = !!ticket.solo;
  const canRecord = isHost || solo;
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
  const advice = quality.alerts
    .map((a) => {
      const english = alertAdvice(a, quality.uploadBehindS);
      if (!english || locale === "en") return english;
      const minutes = quality.uploadBehindS !== null && quality.uploadBehindS >= 120 ? Math.floor(quality.uploadBehindS / 60) : null;
      return translateMaybe(locale, a === "upload_behind" && minutes !== null ? "advice.upload_behind_minutes" : `advice.${a}`, { minutes: minutes ?? 0 }) ?? english;
    })
    .filter((x): x is string => !!x);
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
    if (!canRecord || !state) return false;
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

  // Presentation only: how the tiles are laid out, and the full-screen view. Nothing here reaches the server.
  const [layout, setLayout] = useState<Layout>("grid");
  const [full, setFull] = useState(false);
  const fullOpen = full && !ended;
  const exitFull = useRef<HTMLButtonElement>(null);
  const enterFull = useRef<HTMLButtonElement>(null);
  const wasFull = useRef(false);
  useEffect(() => {
    if (!fullOpen) {
      // Back from full screen: focus returns to the button that opened it.
      if (wasFull.current) enterFull.current?.focus();
      wasFull.current = false;
      return;
    }
    wasFull.current = true;
    exitFull.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    // The page behind is inert and covered: it shouldn't scroll under the full-screen view.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [fullOpen]);

  const offsetMs = ready.clock?.offsetMs ?? 0;
  const clock = useElapsed(recording?.startedAt ?? null, offsetMs);
  const recordDisabled = busy || (!recording && connection !== "live");
  const toggleRecording = () => void (recording ? hostAction(`/recordings/${recording.id}/stop`) : hostAction("/recordings"));
  // A solo recording stops by itself at its limit.
  const soloLimitMs = ticket.solo ? ticket.solo.maxMinutes * 60_000 : null;
  const soloRecordingId = soloLimitMs !== null ? (recording?.id ?? null) : null;
  const soloStartedAt = recording?.startedAt ?? 0;
  useEffect(() => {
    if (!soloRecordingId || soloLimitMs === null) return;
    const id = setTimeout(() => void hostAction(`/recordings/${soloRecordingId}/stop`), Math.max(0, soloStartedAt + soloLimitMs - (localNow() + offsetMs)));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloRecordingId, soloLimitMs, soloStartedAt, offsetMs]);
  function toggleCamera() {
    setCameraOff(!cameraOff);
    void call.setCameraOff(!cameraOff);
  }

  // Sharing a screen: the browser asks which, the others see a copy in the call, and while a
  // recording runs it is recorded on this device as a track of its own (picture only).
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const otherSharing = call.peers.find((p) => p.screen);
  async function toggleScreen() {
    setScreenNote(null);
    if (screen) {
      screen.getTracks().forEach((t) => t.stop());
      setScreen(null);
      return;
    }
    try {
      const shared = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 30 } }, audio: false });
      // The browser's own "Stop sharing" button ends it too.
      shared.getVideoTracks()[0]?.addEventListener("ended", () => setScreen((now) => (now === shared ? null : now)));
      setScreen(shared);
    } catch (err) {
      // Closing the browser's picker isn't an error.
      if (!(err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError"))) setScreenNote("Your screen couldn't be shared.");
    }
  }
  useEffect(() => {
    void controller.current?.setScreen(screen);
    void call.setScreen(screen?.getVideoTracks()[0] ?? null);
  }, [screen, call.setScreen]);
  // The session ending ends the share.
  useEffect(() => {
    if (!ended) return;
    setScreen((now) => {
      now?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, [ended]);
  // Leaving the room ends the share.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => () => screenRef.current?.getTracks().forEach((t) => t.stop()), []);
  const screenTile = screen ? { label: "Your screen" } : otherSharing ? { label: `${otherSharing.name}'s screen`, track: otherSharing.screen } : null;

  const participants = state?.participants ?? [];
  const connectedCount = present ? participants.filter((p) => present.has(p.id)).length : null;
  const peerById = new Map(call.peers.map((p) => [p.id, p]));
  const callLive = call.status === "connected";
  const someoneTalking = (call.localSpeaking && !micMuted) || call.peers.some((p) => p.speaking);

  // The host's view of everyone's device reports. A report that has gone quiet says nothing about
  // now (offline, asleep or left), so it never counts as "up to date" or keeps an old "behind".
  const now = useNow(5000);
  const health = isHost && state ? state.health : [];
  const staleIds = new Set(health.filter((h) => now + offsetMs - h.reportedAt > STALE_REPORT_MS).map((h) => h.participantId));
  const behind = new Map<string, number | null>();
  for (const h of health) if (!staleIds.has(h.participantId) && h.alerts.includes("upload_behind")) behind.set(h.participantId, h.uploadBehindS);
  const badges = new Map([...behind].map(([id, s]) => [id, behindText(s)]));
  for (const id of staleIds) if (id !== ticket.participantId) badges.set(id, "Not reporting");
  // Who needs the host's attention, in words: shown in the full-screen view, where the panel is hidden.
  const pastLateStart = usePast(recording ? recording.startedAt + LATE_START_MS - offsetMs : null);
  const attention = !isHost
    ? []
    : participants.flatMap((p) => {
        const reasons: string[] = [];
        const report = health.find((h) => h.participantId === p.id);
        if (present && !present.has(p.id)) reasons.push("Not connected");
        if (staleIds.has(p.id)) reasons.push("Not reporting");
        else if (report) reasons.push(...report.alerts.filter((a) => a !== "no_headphones").map((a) => alertLabel(a, report.uploadBehindS)));
        if (recording && pastLateStart && !p.producer && !state?.uploads.some((u) => u.participantId === p.id)) reasons.push("Not recording yet");
        return reasons.length > 0 ? [{ id: p.id, name: p.displayName, reasons }] : [];
      });

  const notices = (
    <>
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
      {screenNote && (
        <Notice tone="warn" data-testid="screen-note">
          {screenNote}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </>
  );
  // This person's own alerts. Rendered once: under the recording card, or in the full-screen view.
  const ownAlerts = (
    <>
      {(advice.length > 0 || nudge) && (
        <div className="flex flex-col gap-2" data-testid="own-alerts">
          {advice.map((text) => (
            <AlertLine key={text}>{text}</AlertLine>
          ))}
          {nudge && (
            <div data-testid="talk-nudge" role="status" className="animate-fade-up rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-2">
              {nudge}
            </div>
          )}
        </div>
      )}
      {micMuted && recording && <AlertLine>{t("room.muted")}</AlertLine>}
      {screenMayLock && awake && <AlertLine>{t("room.screenOn")}</AlertLine>}
    </>
  );

  const hearOthers = call.audioBlocked && call.peers.length > 0 && (
    <button
      type="button"
      onClick={call.startAudio}
      className={cn(STAGE_WHITE_BUTTON, fullOpen ? "h-11 rounded-[22px] px-4" : "h-9 rounded-md px-3")}
    >
      Click to hear the others
    </button>
  );
  const invite = isHost && state && <InviteButton studioId={state.session.studioId} large={fullOpen} />;
  const size = fullOpen ? "lg" : "md";
  const stageControls = (
    <>
      <StageButton
        size={size}
        active={micMuted}
        aria-pressed={micMuted}
        aria-label={micMuted ? t("room.unmute") : t("room.mute")}
        title="Mute or unmute (⌘⇧M / Ctrl+Shift+M)"
        onClick={toggleMute}
      >
        <Icon d={micMuted ? ICON.micOff : ICON.mic} className={fullOpen ? "size-[19px]" : "size-[18px]"} />
      </StageButton>
      {hasCamera && (
        <StageButton
          size={size}
          active={cameraOff}
          aria-pressed={cameraOff}
          aria-label={cameraOff ? t("room.cameraOn") : t("room.cameraOffBtn")}
          title={cameraOff ? t("room.cameraOn") : t("room.cameraOffBtn")}
          onClick={toggleCamera}
        >
          <Icon d={cameraOff ? ICON.camOff : ICON.cam} className={fullOpen ? "size-[19px]" : "size-[18px]"} />
        </StageButton>
      )}
      {canShare && (
        <StageButton
          size={size}
          active={!!screen}
          aria-pressed={!!screen}
          disabled={!screen && !!otherSharing}
          aria-label={screen ? t("room.stopShare") : t("room.share")}
          title={screen ? t("room.stopShare") : otherSharing ? `${otherSharing.name} is sharing their screen` : t("room.share")}
          onClick={() => void toggleScreen()}
        >
          <Icon d={ICON.screen} className={fullOpen ? "size-[19px]" : "size-[18px]"} />
        </StageButton>
      )}
      <StageButton
        ref={filtersPanel.button}
        size={size}
        active={false}
        className={cn("relative", filtersPanel.open && "ring-2 ring-white/50")}
        aria-expanded={filtersPanel.open}
        aria-controls="room-filters"
        aria-label={filtersOn(prefs.filters, hasCamera && !cameraOff) ? t("filters.titleOn") : t("filters.title")}
        title={t("filters.title")}
        onClick={filtersPanel.toggle}
      >
        <Icon d={ICON.sliders} className={fullOpen ? "size-[19px]" : "size-[18px]"} />
        {filtersOn(prefs.filters, hasCamera && !cameraOff) && <FilterDot />}
      </StageButton>
      {/* The layouts only differ once someone else is in the call, and not at all on a phone's width, where tiles stack either way. */}
      {call.peers.length > 0 && (
        <span className={cn("flex items-center gap-1.5 max-sm:hidden", fullOpen && "gap-2")}>
          <StageSeparator tall={fullOpen} />
          {LAYOUTS.map(([id, name, d]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLayout(id)}
              aria-pressed={layout === id}
              aria-label={name}
              title={name}
              className={cn(
                "grid cursor-pointer place-items-center text-white transition-colors hover:bg-white/28",
                fullOpen ? "size-11 rounded-full" : "size-9 rounded-md",
                layout === id ? "bg-white/28" : "bg-white/12",
              )}
            >
              <Icon d={d} className={fullOpen ? "size-[19px]" : "size-[18px]"} />
            </button>
          ))}
        </span>
      )}
      {(hearOthers || invite || !fullOpen) && <StageSeparator tall={fullOpen} />}
      {hearOthers}
      {invite}
    </>
  );
  const recLabel = canRecord ? (recording ? "Stop recording" : "Start recording") : recording ? t("room.recording") : t("room.waitingRecord");

  return (
    <div className="room-scale flex flex-col">
      <header inert={fullOpen} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[clamp(14px,3vw,28px)] py-3">
        <span className="flex min-w-0 flex-wrap items-center gap-3">
          <LogoMark className="size-[26px]" />
          <span className="truncate text-[15px] font-medium">{ticket.studio.name}</span>
          <RecPill clock={clock} />
        </span>
        {!ended && (
          <button
            type="button"
            onClick={() => setPanelOpen(!panelOpen)}
            aria-pressed={panelOpen}
            className={cn(
              "inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-md border px-3 text-sm font-medium shadow-xs transition-colors",
              panelOpen ? "border-ink bg-ink text-ink-text hover:bg-ink-hover" : "border-border bg-surface text-text hover:bg-surface-2",
            )}
          >
            <Icon d={ICON.people} className="size-[15px]" />
            {t("room.people")}
          </button>
        )}
      </header>

      {!fullOpen && <div className="flex flex-col gap-2 px-[clamp(14px,3vw,28px)] pt-3 empty:hidden">{notices}</div>}

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
        <div className="flex flex-1 flex-col lg:flex-row">
          <div className="min-w-0 flex-1 px-[clamp(14px,3vw,28px)] pt-[22px] pb-8">
            {/* No entrance animation on this wrapper: an animated transform would trap the full-screen stage inside it. */}
            <div className="mx-auto flex max-w-[860px] flex-col gap-5">
              {/*
                The call stage: dark in both themes, so focus rings are light here. Full screen is this
                same element laid over the page (never a second grid), so nobody's video or sound is
                re-attached when it opens or closes.
              */}
              <section
                role={fullOpen ? "dialog" : undefined}
                aria-modal={fullOpen || undefined}
                aria-label={fullOpen ? "Full screen studio" : "Call"}
                className={cn(
                  "text-white [--ring:#fafafa]",
                  fullOpen ? "fixed inset-0 z-40 flex flex-col bg-[#09090b]" : "relative overflow-hidden rounded-2xl bg-[#18181b] p-3",
                )}
              >
                {fullOpen && (
                  <div className="flex shrink-0 items-center justify-between gap-4 px-[18px] py-3.5">
                    <span className="flex min-w-0 items-center gap-3">
                      <LogoMark className="size-[26px]" />
                      <span className="truncate text-[15px] font-medium">{ticket.studio.name}</span>
                    </span>
                    <span className="flex items-center gap-2.5">
                      {/* A fixed terracotta dark enough for white text: this view is dark in both themes. */}
                      <span
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2.5 py-[5px] text-[13px] font-semibold whitespace-nowrap",
                          recording ? "bg-[#c43c25]" : "bg-white/12",
                        )}
                      >
                        <span aria-hidden className={cn("size-[7px] rounded-full bg-white", recording && "animate-rec-pulse")} />
                        {recording ? t("room.recording") : t("room.ready")}
                        {clock && <span className="font-mono font-medium tabular-nums">{clock}</span>}
                      </span>
                      <span
                        className="flex items-center gap-1.5 rounded-md bg-white/8 px-2.5 py-[5px] text-[13px] whitespace-nowrap text-white/80"
                        title={connectedCount !== null ? `${connectedCount} of ${participants.length} in the call` : `${participants.length} in the studio`}
                      >
                        <Icon d={ICON.people} className="size-3.5" />
                        <span className="sr-only">{connectedCount !== null ? "People in the call:" : "People in the studio:"}</span>
                        {connectedCount ?? participants.length}
                      </span>
                      <button
                        ref={exitFull}
                        type="button"
                        onClick={() => setFull(false)}
                        aria-label={t("room.exitFull")}
                        className="inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-md border border-white/16 px-[11px] text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-white/10"
                      >
                        <Icon d={ICON.shrink} className="size-3.5" />
                        <span className="max-sm:hidden">{t("room.exitFull")}</span>
                      </button>
                    </span>
                  </div>
                )}
                {/* Problems stay in sight in full screen: the page's notices, this person's alerts, and (host) who needs attention. */}
                {fullOpen && (
                  <div className="flex max-h-[30vh] shrink-0 flex-col gap-2 overflow-auto px-[18px] pb-2.5 empty:hidden">
                    {notices}
                    {ownAlerts}
                    {attention.map((a) => (
                      <AlertLine key={a.id}>
                        <span className="font-medium">{a.name}:</span> {a.reasons.join(", ")}
                      </AlertLine>
                    ))}
                  </div>
                )}
                <div className={cn(fullOpen && "flex min-h-0 flex-1 px-[18px]")}>
                  <CallGrid
                    stream={ready.stream}
                    selfId={ticket.participantId}
                    selfName={selfName}
                    selfMicMuted={micMuted}
                    selfCameraOff={cameraOff}
                    selfSpeaking={call.localSpeaking}
                    selfFilters={prefs.filters}
                    selfMirror={prefs.mirror}
                    peers={call.peers}
                    recording={!!recording}
                    layout={layout}
                    variant={fullOpen ? "full" : "stage"}
                    badges={isHost ? badges : undefined}
                    screen={screenTile}
                  />
                </div>
                {fullOpen ? (
                  <div className="flex shrink-0 justify-center px-[18px] pt-3.5 pb-[18px]">
                    <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-[32px] border border-white/10 bg-white/7 px-2.5 py-2 backdrop-blur-md">
                      <span className="flex items-center gap-3 pr-2.5 pl-0.5">
                        <RecControl recording={!!recording} size={44} onClick={canRecord ? toggleRecording : undefined} disabled={recordDisabled} />
                        <span className={cn("text-sm font-medium whitespace-nowrap", canRecord && "max-sm:hidden")}>{recLabel}</span>
                      </span>
                      <StageSeparator tall />
                      {stageControls}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2.5 px-1 pt-3">
                    <span className="flex items-center gap-[13px] pl-1">
                      {/* For the host, a mouse shortcut to the Record button in the card below (hidden from assistive tech, which uses that one). */}
                      <RecControl
                        recording={!!recording}
                        size={40}
                        onClick={canRecord ? toggleRecording : undefined}
                        disabled={recordDisabled}
                        duplicate
                      />
                      <span className="flex flex-col leading-[1.3]">
                        <span className="text-sm font-medium whitespace-nowrap">{recLabel}</span>
                        {/* A guest's clock only runs while they're recorded; the host's sits at 00:00 beside Record. */}
                        {(canRecord || clock) && <span className="text-xs text-white/60 tabular-nums">{clock ?? "00:00"}</span>}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {stageControls}
                      <button
                        ref={enterFull}
                        type="button"
                        onClick={() => setFull(true)}
                        className={cn(STAGE_WHITE_BUTTON, "h-9 gap-[7px] rounded-md px-3")}
                      >
                        <Icon d={ICON.expand} className="size-[15px]" />
                        {t("room.fullScreen")}
                      </button>
                    </span>
                  </div>
                )}
                {/* Inside the stage, so it works in full screen too (everything outside is inert there). */}
                {filtersPanel.open && (
                  <FiltersPanel
                    id="room-filters"
                    panelRef={filtersPanel.panel}
                    prefs={prefs}
                    onChange={setPrefs}
                    hasCamera={hasCamera && !cameraOff}
                    blur={{ ...blur, late: blurLate }}
                    tone="stage"
                    onClose={filtersPanel.close}
                    className={cn(
                      "absolute z-10 w-[min(330px,calc(100%-24px))] animate-fade-up overflow-auto",
                      fullOpen ? "right-[18px] bottom-[92px] max-h-[calc(100%-104px)]" : "right-3 bottom-[62px] max-h-[calc(100%-74px)]",
                    )}
                  />
                )}
              </section>

              {/* The recording: Record/Stop, the clock, and (for the host) everyone's track as it's saved. */}
              <section inert={fullOpen} className="flex animate-fade-up flex-col overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 bg-linear-to-b from-accent-tint to-surface px-5 py-[18px]">
                  <span className="flex items-center gap-[18px]">
                    <span className="relative grid size-[60px] shrink-0 place-items-center">
                      {recording &&
                        [0, 0.8, 1.6].map((d) => (
                          <span
                            key={d}
                            aria-hidden
                            className="absolute inset-0 animate-ring-slow rounded-full border-2 border-accent"
                            style={{ animationDelay: `${d}s` }}
                          />
                        ))}
                      <BigRecordButton
                        recording={!!recording}
                        onClick={canRecord ? toggleRecording : undefined}
                        disabled={recordDisabled}
                      />
                    </span>
                    <span className="flex min-w-0 flex-col gap-[3px]">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tracking-[.02em]",
                            recording ? "bg-accent-soft text-accent-strong" : "bg-surface-2 text-muted",
                          )}
                        >
                          <span className={cn("size-1.5 rounded-full bg-current", recording && "animate-rec-pulse")} />
                          {recording ? "Recording" : "Ready"}
                        </span>
                        {/* Moves only while someone is actually talking (the call's voice detection): flat for silence or a dead mic. */}
                        <span aria-hidden className={cn("flex h-[18px] items-center gap-0.5", recording ? "text-accent-strong" : "text-muted")}>
                          {HEADER_EQ.map((d, k) => (
                            <span
                              key={k}
                              className="h-[18px] w-[3px] rounded-[2px] bg-current"
                              style={{
                                transform: "scaleY(.25)",
                                animation: recording && someoneTalking ? `eq ${d}s ease-in-out ${(-k * 0.13).toFixed(2)}s infinite` : "none",
                              }}
                            />
                          ))}
                        </span>
                      </span>
                      <span className="text-[36px] leading-[1.1] font-medium tracking-[-.03em] tabular-nums">{clock ?? "00:00"}</span>
                      {canRecord ? (
                        <span className="text-[12.5px] whitespace-nowrap text-muted">
                          {solo ? (recording ? "Press to stop when you're done" : "Press to start recording yourself") : recording ? "Press to stop recording for everyone" : "Press to start recording everyone"}
                        </span>
                      ) : (
                        <span className="text-[13.5px] font-medium text-text-2">
                          {recording ? t("room.beingRecorded") : t("room.waitingHost")}
                        </span>
                      )}
                    </span>
                  </span>
                  {isHost && state && (
                    <span className="-ml-[18px] flex flex-wrap gap-y-2.5">
                      {[
                        {
                          icon: ICON.people,
                          k: "People",
                          v: connectedCount !== null ? `${connectedCount} of ${participants.length} in the call` : `${participants.length} in the studio`,
                        },
                        { icon: ICON.cloudCheck, k: "Uploads", v: uploadsSummary(state, (id) => behind.has(id) || staleIds.has(id) || (!!present && !present.has(id))) },
                        {
                          icon: ICON.cloudUp,
                          k: "Saved so far",
                          v: state.recording && state.uploads.length > 0 ? mb(state.uploads.reduce((sum, u) => sum + u.bytes, 0)) : "—",
                        },
                      ].map((st) => (
                        <span key={st.k} className="flex flex-col gap-1 border-l border-border px-[18px] py-0.5">
                          <span className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-muted">
                            <Icon d={st.icon} className="size-3.5" />
                            {st.k}
                          </span>
                          <span className="text-base font-medium whitespace-nowrap tabular-nums">{st.v}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                {isHost &&
                  state &&
                  // The recording card lists who is recorded: a producer isn't.
                  participants.filter((p) => !p.producer).map((p) => {
                    const self = p.id === ticket.participantId;
                    const peer = peerById.get(p.id);
                    return (
                      <TrackRow
                        key={p.id}
                        name={p.displayName}
                        self={self}
                        role={p.role}
                        muted={self ? micMuted : !!peer?.micMuted}
                        speaking={self ? call.localSpeaking && !micMuted : !!peer?.speaking}
                        away={!!present && !present.has(p.id)}
                        recording={!!recording}
                        callLive={callLive}
                        upload={state.recording ? state.uploads.find((u) => u.participantId === p.id) : undefined}
                        hasRecording={!!state.recording}
                        behindS={behind.has(p.id) ? (behind.get(p.id) ?? null) : undefined}
                        stale={staleIds.has(p.id)}
                      />
                    );
                  })}

                <LocalUploadStatus recording={!!recording} finishing={!recording && localActive} upload={upload} offsetMs={offsetMs} />

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-divider bg-canvas px-5 py-[11px] text-[13.5px] text-muted">
                  <span className="flex min-w-0 flex-[1_1_240px] items-center gap-2">
                    <Icon d={ICON.shield} className="size-[15px] text-ok" />
                    <span className="text-pretty">
                      {recording
                        ? t("room.ownDevice")
                        : isHost
                          ? "Nothing is being recorded right now. Press Record when everyone is ready."
                          : t("room.nothingYet")}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    <ConnectionLabel status={connection} />
                    <CallLabel status={call.status} />
                  </span>
                </div>
              </section>

              {!fullOpen && ownAlerts}
            </div>
          </div>

          {panelOpen && (
            <aside inert={fullOpen} className="w-full shrink-0 border-t border-border bg-canvas lg:w-[380px] lg:border-t-0 lg:border-l">
              <div className="flex flex-col gap-4 p-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh/var(--room-zoom))] lg:min-h-[calc(100dvh/var(--room-zoom)-58px)] lg:overflow-auto">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-medium">{t("room.inStudio", { count: participants.length })}</h2>
                  <span className="flex items-center gap-2">
                    {present && (
                      <span className="text-[13px] text-muted">
                        {connectedCount} of {participants.length} connected
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={t("room.closePanel")}
                      onClick={() => setPanelOpen(false)}
                      className="grid size-7 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      <Icon d={ICON.close} className="size-[15px]" />
                    </button>
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {participants.map((p) => {
                    const away = present && !present.has(p.id);
                    return (
                      <li key={p.id} className="flex gap-[11px] rounded-xl border border-border bg-surface px-3 py-[11px]" data-testid="participant">
                        <Avatar name={p.displayName} className={cn("size-[34px] text-xs", away && "opacity-50 grayscale")} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-[14.5px] font-medium">
                              {p.displayName}
                              {p.id === ticket.participantId && <span className="font-normal text-muted"> {t("room.you")}</span>}
                              {p.role === "host" && <span className="font-normal text-muted"> · {t("room.host")}</span>}
                            </span>
                            {shares && <TalkShare share={shares.get(p.id) ?? 0} />}
                          </span>
                          {p.producer ? (
                            <span className="text-[13.5px] text-muted" data-testid="producer-row">
                              Producer · not recorded
                            </span>
                          ) : isHost && state?.recording ? (
                            <ParticipantUpload
                              upload={state.uploads.find((u) => u.participantId === p.id)}
                              stopped={state.recording.status === "stopped"}
                              away={!!away}
                              startedAt={state.recording.startedAt}
                              offsetMs={offsetMs}
                            />
                          ) : (
                            present && (
                              <span
                                className={cn("flex items-center gap-[7px] text-[13.5px]", away ? "text-warn-strong" : "text-muted")}
                                title={away ? t("room.notConnected") : t("room.inCall")}
                              >
                                <StatusDot tone={away ? "warn" : "ok"} />
                                {away ? t("room.notConnected") : t("room.inCall")}
                              </span>
                            )
                          )}
                          {isHost && state && (
                            <HealthChips health={state.health.find((h) => h.participantId === p.id)} offsetMs={offsetMs} />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {(isHost || solo) && <GuidePanel ticket={ticket} recordingId={recording?.id ?? null} title={solo ? "Questions" : "Guide"} />}
                {!isHost && (
                  <div className="flex flex-col gap-[9px] rounded-xl border border-border bg-surface p-3.5 text-sm leading-normal text-text-2">
                    <span>• {t("room.tipDrops")}</span>
                    <span>• {t("room.tipTab")}</span>
                    <span>• {t("room.tipPower")}</span>
                  </div>
                )}
                {isHost && (
                  <Button
                    variant="danger"
                    size="sm"
                    className="mt-auto w-full"
                    disabled={busy}
                    onClick={() => confirm("End the session for everyone?") && hostAction("/end")}
                  >
                    End session for everyone
                  </Button>
                )}
                {solo && !isHost && (
                  <Button variant="secondary" size="sm" className="mt-auto w-full" disabled={busy || !!recording} onClick={() => hostAction("/end")} data-testid="solo-finish">
                    I&apos;m finished
                  </Button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {flash && (
        <p
          role="status"
          className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 animate-fade-up rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-ink-text shadow-[0_10px_30px_-10px_rgba(0,0,0,.4)]"
          data-testid="shortcut-flash"
        >
          {flash}
        </p>
      )}
    </div>
  );
}

const LAYOUTS: Array<[Layout, string, string]> = [
  ["grid", "Grid", ICON.grid],
  ["speaker", "Speaker", ICON.speaker],
  ["side", "Side by side", ICON.side],
];

/** The recording card's level bars (durations from the design). */
const HEADER_EQ = [0.9, 0.7, 1.1, 0.6, 0.95, 0.75, 1.05, 0.65, 0.85];

/** White button on the dark stage (both themes), like the design's Leave/Full screen. */
const STAGE_WHITE_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center bg-white text-sm font-medium whitespace-nowrap text-[#18181b] transition-colors hover:bg-[#e4e4e7]";

function StageButton({
  size,
  active,
  className,
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { size: "md" | "lg"; active: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "grid cursor-pointer place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        // On touch screens every stage button is a thumb's size.
        size === "lg" ? "size-11" : "size-[38px] pointer-coarse:size-11",
        active ? "bg-accent text-accent-text hover:bg-accent-hover" : "bg-white/12 text-white hover:bg-white/28",
        className,
      )}
      {...props}
    />
  );
}

function StageSeparator({ tall }: { tall?: boolean }) {
  return <span aria-hidden className={cn("mx-1 w-px", tall ? "h-6 bg-white/14" : "h-5 bg-white/20")} />;
}

/** The round terracotta record control on the stage: a dot to start, a square to stop. */
function RecControl({
  recording,
  size,
  onClick,
  disabled,
  duplicate,
}: {
  recording: boolean;
  size: 40 | 44;
  onClick?: () => void;
  disabled?: boolean;
  /** A second copy of the card's Record button: clickable with the mouse, but out of the accessibility tree and tab order, and it never takes focus. */
  duplicate?: boolean;
}) {
  const glyph = (
    <span
      className="block bg-accent-text transition-all duration-300"
      style={{ width: recording ? 13 : 15, height: recording ? 13 : 15, borderRadius: recording ? 3 : "50%" }}
    />
  );
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {recording &&
        [0, 0.66, 1.33].map((d) => (
          <span key={d} aria-hidden className="absolute inset-0 animate-ring-slow rounded-full bg-accent" style={{ animationDelay: `${d}s` }} />
        ))}
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          // Focus must never land on an element assistive tech can't see.
          onMouseDown={duplicate ? (e) => e.preventDefault() : undefined}
          disabled={disabled}
          aria-label={duplicate ? undefined : recording ? "Stop recording" : "Record"}
          aria-hidden={duplicate || undefined}
          tabIndex={duplicate ? -1 : undefined}
          title={`${recording ? "Stop recording" : "Start recording"} (⌘⇧R / Ctrl+Shift+R)`}
          className="relative grid size-full cursor-pointer place-items-center rounded-full bg-accent transition-[transform,background-color] hover:bg-accent-hover active:scale-[.93] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {glyph}
        </button>
      ) : (
        <span aria-hidden className={cn("relative grid size-full place-items-center rounded-full", recording ? "bg-accent" : "bg-white/12")}>
          {recording ? glyph : <span className="size-2.5 rounded-full bg-white/60" />}
        </span>
      )}
    </span>
  );
}

/** The recording card's big button (the host's Record/Stop); for guests, the same disc as a status. */
function BigRecordButton({ recording, onClick, disabled }: { recording: boolean; onClick?: () => void; disabled: boolean }) {
  const style = {
    background: recording || onClick ? "radial-gradient(circle at 35% 30%, #f47a5f, var(--accent) 55%, var(--accent-hover))" : "var(--surface-2)",
    boxShadow: `0 0 0 5px var(--surface), 0 0 0 6px ${recording ? "var(--accent-line)" : "var(--border)"}${recording || onClick ? ", 0 10px 24px -8px rgba(196,60,37,.6)" : ""}`,
  };
  const glyph = (
    <span
      className={cn("block transition-all duration-300", recording || onClick ? "bg-accent-text" : "bg-subtle")}
      style={{ width: recording ? 18 : 22, height: recording ? 18 : 22, borderRadius: recording ? 3 : "50%" }}
    />
  );
  if (!onClick) {
    return (
      <span aria-hidden className="relative grid size-[60px] place-items-center rounded-full" style={style}>
        {glyph}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={recording ? "Stop recording" : "Record"}
      title="Start or stop recording (⌘⇧R / Ctrl+Shift+R)"
      className="relative grid size-[60px] cursor-pointer place-items-center rounded-full transition-[transform,box-shadow] duration-300 active:scale-[.94] disabled:cursor-not-allowed disabled:opacity-50"
      style={style}
    >
      {glyph}
    </button>
  );
}

/** One person's track in the host's recording card: who's talking, and whether their recording is safely here. */
function TrackRow({
  name,
  self,
  role,
  muted,
  speaking,
  away,
  recording,
  callLive,
  upload,
  hasRecording,
  behindS,
  stale,
}: {
  name: string;
  self: boolean;
  role: "host" | "guest";
  muted: boolean;
  speaking: boolean;
  away: boolean;
  recording: boolean;
  callLive: boolean;
  upload: SessionState["uploads"][number] | undefined;
  hasRecording: boolean;
  /** Set (seconds, or null when unknown) when their upload is behind. */
  behindS: number | null | undefined;
  /** Their device has stopped reporting (offline, asleep or left). */
  stale: boolean;
}) {
  const off = !recording || muted || away;
  const talking = speaking && !off;
  const voice = muted ? "Muted" : away ? "Not connected" : !recording ? "Ready" : !callLive ? "" : talking ? "Speaking" : "Listening";
  const done = !!upload && upload.tracks > 0 && upload.completeTracks === upload.tracks;
  // "Saved" only once every track is complete on the server. Until then it's still on its way,
  // and someone who's offline or whose device went quiet is a warning, never a green tick.
  const pill = !hasRecording
    ? null
    : done
      ? { tone: "ok", icon: ICON.cloudCheck, text: "Saved" }
      : away
        ? { tone: "warn", icon: ICON.alert, text: "Offline" }
        : stale
          ? { tone: "warn", icon: ICON.alert, text: "Not reporting" }
          : behindS !== undefined
            ? { tone: "warn", icon: ICON.cloudUp, text: behindText(behindS) }
            : upload
              ? { tone: recording ? "ok" : "warn", icon: ICON.cloudUp, text: "Uploading" }
              : { tone: "idle", icon: ICON.clock, text: recording ? "Waiting" : "Nothing" };
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 border-t border-divider px-5 py-[13px] sm:grid-cols-[34px_minmax(0,140px)_minmax(40px,1fr)_auto]">
      <span className="relative grid size-[34px] place-items-center">
        {talking &&
          [0, 0.6, 1.2].map((d) => (
            <span key={d} aria-hidden className="absolute inset-0 animate-ring rounded-full border-2 border-accent" style={{ animationDelay: `${d}s` }} />
          ))}
        <Avatar
          name={name}
          className={cn("relative size-[34px] text-xs ring-2 transition-shadow", talking ? "ring-accent" : "ring-surface", away && "opacity-50 grayscale")}
        />
        <span
          aria-hidden
          // Fixed fills, dark enough for the white glyph in both themes.
          className={cn(
            "absolute -right-1 -bottom-1 grid size-[17px] place-items-center rounded-full border-2 border-surface text-white transition-colors",
            muted ? "bg-[#dc2626]" : talking ? "bg-[#c43c25]" : "bg-[#71717a]",
          )}
        >
          <Icon d={muted ? ICON.micOff : ICON.mic} className="size-[9px]" strokeWidth={2.6} />
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[15px] font-medium">
          {name}
          {self && <span className="font-normal text-muted"> (you)</span>}
        </span>
        {/* What the server has from them. Your own row leaves the figure to the line below, which counts on this device. */}
        <span className="truncate text-[12.5px] text-muted">
          {role === "host" ? "Host" : "Guest"}
          {upload && !self && ` · ${mb(upload.bytes)} received`}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "flex h-[34px] min-w-0 items-center gap-2.5 overflow-hidden rounded-full px-3 transition-colors max-sm:hidden",
          talking ? "bg-accent-soft" : "bg-surface-2",
        )}
      >
        <span className="flex h-[22px] min-w-0 flex-1 items-center justify-between gap-0.5 overflow-hidden">
          {Array.from({ length: 22 }, (_, k) => (
            <span
              key={k}
              className={cn(
                "h-[22px] max-w-[3px] min-w-[2px] flex-1 rounded-[2px] transition-colors",
                talking ? "bg-accent" : off ? "bg-border-strong" : "bg-subtle",
              )}
              // Moves only while the call hears them talking; flat otherwise, so it never suggests sound that isn't there.
              style={{ transform: `scaleY(${off ? 0.1 : 0.2})`, animation: talking ? eqAnimation(k) : "none" }}
            />
          ))}
        </span>
        {voice && (
          <span className={cn("text-xs font-medium whitespace-nowrap transition-colors", talking ? "text-accent-strong" : "text-muted")}>{voice}</span>
        )}
      </span>
      {pill ? (
        <span
          className={cn(
            "flex items-center gap-1.5 justify-self-end rounded-md py-[3px] pr-2 pl-1.5 text-[12.5px] font-medium whitespace-nowrap",
            pill.tone === "ok" ? "bg-ok-soft text-ok-strong" : pill.tone === "warn" ? "bg-warn-soft text-warn-strong" : "bg-surface-2 text-muted",
          )}
        >
          <Icon d={pill.icon} className="size-3.5" />
          {pill.text}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

/** "48 s behind", "3 min behind", or just "Upload behind" when the device didn't say. */
function behindText(s: number | null | undefined) {
  if (s === null || s === undefined) return "Upload behind";
  return s >= 120 ? `${Math.floor(s / 60)} min behind` : `${s} s behind`;
}

/**
 * The host's "Uploads" figure. While recording: how many of everyone in the studio are sending and
 * up to date (not behind, offline or gone quiet). Once stopped: how many of those who recorded have
 * arrived in full.
 */
function uploadsSummary(state: SessionState, troubled: (participantId: string) => boolean) {
  if (!state.recording) return "—";
  if (state.recording.status === "recording") {
    const ok = state.uploads.filter((u) => !troubled(u.participantId)).length;
    return `${ok} of ${state.participants.length} up to date`;
  }
  if (state.uploads.length === 0) return "—";
  return `${state.uploads.filter((u) => u.tracks > 0 && u.completeTracks === u.tracks).length} of ${state.uploads.length} received`;
}

/** An amber line with a warning sign: advice for this person about their own setup. */
function AlertLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex animate-fade-up items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13.5px] leading-[1.45] text-text-2">
      <Icon d={ICON.alert} className="mt-0.5 size-[15px] text-warn" />
      <span className="text-pretty">{children}</span>
    </div>
  );
}

/** One person's share of the talking in this recording (talk balance, host only). */
function TalkShare({ share }: { share: number }) {
  const percent = Math.round(share * 100);
  return (
    <span className="shrink-0 text-[12.5px] whitespace-nowrap text-muted tabular-nums" data-testid="talk-share" data-share={percent}>
      {percent}% talking
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
    <span className="flex flex-wrap gap-1.5" data-testid="health">
      {chips.map((c) => (
        <span
          key={c.key}
          data-alert={c.key}
          className={cn(
            "flex items-center gap-[5px] rounded-[7px] px-[7px] py-px text-[12.5px] whitespace-nowrap",
            c.info ? "bg-surface-2 text-muted" : "bg-warn-soft text-warn-strong",
          )}
        >
          {!c.info && <Icon d={ICON.alert} className="size-3" />}
          {c.label}
        </span>
      ))}
    </span>
  );
}

/** Copies the studio's guest link; the room doesn't know it until asked. */
async function copyInviteLink(studioId: string) {
  try {
    const { inviteCode } = await apiFetch<{ inviteCode: string }>(`/studios/${studioId}`);
    await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    return true;
  } catch {
    return false;
  }
}

function InviteButton({ studioId, large }: { studioId: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (await copyInviteLink(studioId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      window.open(`/studios/${studioId}`, "_blank");
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the guest link (⌘⇧L / Ctrl+Shift+L)"
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-[7px] bg-white/14 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-white/28",
        large ? "h-11 rounded-[22px] px-4" : "h-9 rounded-md px-3",
      )}
    >
      {copied && <Icon d={ICON.check} className="size-[15px]" />}
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
  const { t } = useT();
  const ownSent = upload?.uploadedBytes ?? 0;
  const ownLeft = upload?.pendingBytes ?? 0;
  const ownDone = !finishing && (upload?.idle ?? true);
  // pct null: the host can't know how much is still to come, so the bar shows "arriving" without a share.
  const rows: Array<{ name: string; done: boolean; label: string; pct: number | null }> = isHost
    ? participants
        .map((p) => ({ p, u: uploads.find((u) => u.participantId === p.id) }))
        .filter((r) => r.u)
        .map(({ p, u }) => {
          const done = u!.tracks > 0 && u!.completeTracks === u!.tracks;
          return { name: p.displayName, done, label: done ? "Received" : `Still arriving · ${mb(u!.bytes)} so far`, pct: done ? 100 : null };
        })
    : [
        {
          name: selfName,
          done: ownDone,
          label: ownDone ? t("end.sent") : t("end.leftToSend", { left: mb(ownLeft) }),
          pct: ownDone ? 100 : Math.max(5, Math.round((ownSent / Math.max(1, ownSent + ownLeft)) * 100)),
        },
      ];
  const allDone = rows.every((r) => r.done);
  const title = isHost
    ? allDone
      ? "That's a wrap. Everything's here."
      : "That's a wrap!"
    : allDone
      ? t("end.thanksDone", { name: selfName })
      : t("end.thanks", { name: selfName });
  const sub = isHost
    ? rows.length === 0
      ? "The session has ended. Nothing was recorded in it."
      : allDone
        ? "Every recording has arrived. Your files will be ready to download in a few minutes."
        : "Everyone's recordings are still arriving. You can close this page; they'll keep coming in."
    : allDone
      ? t("end.reached")
      : t("end.sending");

  return (
    <div className="flex flex-1 justify-center px-[clamp(16px,4vw,44px)] py-7">
      <div className="flex w-full max-w-[720px] animate-fade-up flex-col gap-[22px]" data-testid="session-ended">
        <div className="flex items-start gap-3.5">
          <span
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full",
              allDone ? "bg-ok-soft text-ok-strong" : "bg-accent-soft text-accent-strong",
            )}
          >
            <Icon d={allDone ? ICON.checkCircle : ICON.cloudUp} className="size-[22px]" />
          </span>
          <div className="flex flex-col gap-[5px]">
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-.025em] text-balance">{title}</h1>
            <p className="text-[14.5px] leading-normal text-pretty text-muted">{sub}</p>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] py-1">
            <span className="pt-3 pb-2 font-medium">{isHost ? "Recordings arriving" : t("end.yourUpload")}</span>
            {rows.map((r) => (
              <div
                key={r.name}
                className="grid grid-cols-1 items-center gap-x-3.5 gap-y-2 border-t border-divider py-3 text-[14.5px] sm:grid-cols-[minmax(96px,auto)_minmax(40px,1fr)_auto]"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={r.name} className="size-6 text-[10px]" />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="h-[5px] overflow-hidden rounded-[3px] bg-border">
                  <span
                    className={cn(
                      "block h-full rounded-[3px] transition-[width] duration-400",
                      r.done ? "bg-ok" : "bg-warn",
                      r.pct === null && "animate-rec-pulse opacity-60",
                    )}
                    style={{ width: `${r.pct ?? 100}%` }}
                  />
                </span>
                <span
                  className={cn(
                    "flex items-center gap-[7px] text-[13.5px] tabular-nums sm:justify-end sm:whitespace-nowrap",
                    r.done ? "text-ok-strong" : "text-warn-strong",
                  )}
                >
                  <Icon d={r.done ? ICON.checkCircle : ICON.cloudUp} className="size-[15px]" />
                  {r.label}
                </span>
              </div>
            ))}
          </div>
        )}
        {isHost && studioId && (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/studios/${studioId}`}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3.5 text-sm font-medium whitespace-nowrap text-ink-text transition-colors hover:bg-ink-hover"
            >
              Go to your studio
            </a>
          </div>
        )}
        {!isHost && (
          <Notice tone={allDone ? "ok" : "warn"}>
            {allDone
              ? t("end.free")
              : t("end.reopen")}
          </Notice>
        )}
        {/* Only once their upload is done: nothing should compete with "keep this tab open". */}
        {!isHost && allDone && <GuestAfterwards ticket={ticket} />}
      </div>
    </div>
  );
}
/** A device starts recording within seconds; longer means it may have missed Record. */
const LATE_START_MS = 20_000;
const READY_POLL_MS = 5_000;
/** Download links are signed for an hour: fetch fresh ones well before that. */
const LINKS_REFRESH_MS = 30 * 60_000;

/**
 * The guest's own recording once it's processed (if the studio allows it), and the "record your
 * own" link (if the server sets one).
 */
function GuestAfterwards({ ticket }: { ticket: SessionTicket }) {
  const { t } = useT();
  const [own, setOwn] = useState<OwnRecordings | null>(null);
  const [recap, setRecap] = useState<RecapStatus | null>(null);
  // Bumped when the guest asks for the email: look again soon, even if the files were already ready.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let next = READY_POLL_MS;
      try {
        const [got, mail] = await Promise.all([
          apiFetch<OwnRecordings>(`/sessions/${ticket.sessionId}/my-recordings`, { token: ticket.token }),
          apiFetch<RecapStatus>(`/sessions/${ticket.sessionId}/recap`, { token: ticket.token }),
        ]);
        if (cancelled) return;
        setOwn(got);
        setRecap(mail);
        if (got.recordings.every((r) => r.processing === "ready" || r.processing === "failed") && mail.status !== "pending") next = LINKS_REFRESH_MS;
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
  }, [ticket, asked]);
  if (!own) return null;

  return (
    <>
      {own.downloads && own.recordings.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-[18px]" data-testid="own-recording">
          <h2 className="font-medium">{t("end.yourRecording")}</h2>
          <OwnFiles recordings={own.recordings} waiting={t("end.gettingReady")} />
          {recap?.enabled && <RecapEmail
              ticket={ticket}
              recap={recap}
              onChange={(next) => {
                setRecap(next);
                setAsked((n) => n + 1);
              }}
            />}
        </div>
      )}
      {own.promoUrl && (
        <a
          href={own.promoUrl}
          target="_blank"
          rel="noopener"
          className="flex flex-col gap-1 rounded-xl border border-accent-line bg-accent-soft px-[18px] py-3.5 transition-colors hover:border-accent"
          data-testid="promo"
        >
          <span className="text-[14.5px] font-medium text-accent-strong">{t("end.promoTitle")}</span>
          <span className="text-[13.5px] leading-normal text-text-2">
            {t("end.promoBody")}
          </span>
        </a>
      )}
    </>
  );
}

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
  const { t } = useT();
  if (!upload || (!recording && !finishing && upload.uploadedChunks === 0 && upload.idle)) return null;
  const behindS = upload.oldestPendingTs !== null ? Math.round((localNow() + offsetMs - upload.oldestPendingTs) / 1000) : 0;
  let tone: "ok" | "warn" | "idle" = "ok";
  let text: string;
  // Recording comes first: the queue is idle between chunks, which doesn't mean we're done.
  if (recording) {
    tone = behindS > 30 ? "warn" : "ok";
    text =
      behindS > 30
        ? t("room.up.behind", { seconds: behindS })
        : t("room.up.recording", { sent: mb(upload.uploadedBytes) });
  } else if (finishing) {
    tone = "warn";
    text = t("room.up.finishing");
  } else if (upload.idle) {
    text = t("room.up.done", { sent: mb(upload.uploadedBytes) });
  } else {
    tone = "warn";
    text = t("room.up.left", { left: mb(upload.pendingBytes) });
  }
  return (
    <p className="flex items-center gap-2 border-t border-divider px-5 py-3 text-[13.5px] text-text-2" role="status" data-testid="local-upload">
      <StatusDot tone={tone} className={cn(tone === "warn" && "animate-rec-pulse")} /> {text}
    </p>
  );
}

function ParticipantUpload({
  upload,
  stopped,
  away,
  startedAt,
  offsetMs,
}: {
  upload: SessionState["uploads"][number] | undefined;
  stopped: boolean;
  away: boolean;
  startedAt: number;
  /** Server time minus this device's clock. */
  offsetMs: number;
}) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (upload || stopped) return setLate(false);
    const id = setTimeout(() => setLate(true), Math.max(0, startedAt + LATE_START_MS - localNow() - offsetMs));
    return () => clearTimeout(id);
  }, [upload, stopped, startedAt, offsetMs]);
  if (!upload) {
    if (stopped) return <span className="text-[13.5px] text-muted">Nothing recorded</span>;
    return late ? (
      <span className="flex items-start gap-[7px] text-[13.5px] text-warn-strong" data-testid="not-recording-yet">
        <Icon d={ICON.alert} className="mt-0.5 size-[15px]" />
        Not recording yet. Ask them to reload the page.
      </span>
    ) : (
      <span className="flex items-center gap-[7px] text-[13.5px] text-muted">
        <Icon d={ICON.loader} className="size-[15px] animate-spin-fast" />
        Starting…
      </span>
    );
  }
  const done = upload.tracks > 0 && upload.completeTracks === upload.tracks;
  const text = done
    ? `✓ Uploaded · ${mb(upload.bytes)}`
    : away
      ? `Offline. Recording is safe on their computer · ${mb(upload.bytes)} sent`
      : `${stopped ? "Uploading" : "Recording"} · ${mb(upload.bytes)} sent`;
  return (
    <span
      className={cn("flex min-w-0 items-center gap-[7px] text-[13.5px]", done ? "text-ok-strong" : away ? "text-warn-strong" : "text-text-2")}
      data-testid="participant-upload"
    >
      <Icon d={done ? ICON.cloudCheck : ICON.cloudUp} className="size-[15px]" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}


function CallLabel({ status }: { status: CallStatus }) {
  const { t } = useT();
  if (status === "off") return null;
  const map = { connecting: "idle", connected: "ok", reconnecting: "warn", failed: "danger" } as const;
  const [tone, label] = [map[status], t(`room.call.${status}`)];
  return (
    <p className="flex items-center gap-2 text-[13px] whitespace-nowrap text-muted" data-testid="call-status">
      <StatusDot tone={tone} /> {label}
    </p>
  );
}

function ConnectionLabel({ status }: { status: ConnectionStatus }) {
  const { t } = useT();
  const map = { connecting: "idle", live: "ok", reconnecting: "warn", unauthorized: "danger" } as const;
  const [tone, label] = [map[status], t(`room.conn.${status}`)];
  return (
    <p className="flex items-center gap-2 text-[13px] whitespace-nowrap text-muted">
      <StatusDot tone={tone} /> {label}
    </p>
  );
}

/** This device's clock, read again every `everyMs`: for things that go stale without any event. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(localNow);
  useEffect(() => {
    const id = setInterval(() => setNow(localNow()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** True once this device's clock passes `at` (null: never). */
function usePast(at: number | null) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    setPast(false);
    if (at === null) return;
    const id = setTimeout(() => setPast(true), Math.max(0, at - localNow()));
    return () => clearTimeout(id);
  }, [at]);
  return past;
}

/** Time since the recording started ("04:12", "1:02:09"), ticking; null when not recording. */
function useElapsed(startedAt: number | null, offsetMs: number): string | null {
  const [now, setNow] = useState(localNow);
  useEffect(() => {
    if (startedAt === null) return;
    setNow(localNow());
    const id = setInterval(() => setNow(localNow()), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) return null;
  const s = Math.max(0, Math.floor((now + offsetMs - startedAt) / 1000));
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "REC 12:04" while recording, "Not recording" otherwise. */
function RecPill({ clock }: { clock: string | null }) {
  const { t } = useT();
  if (clock === null) {
    return (
      <span className="inline-flex items-center gap-[7px] rounded-md bg-surface-2 px-2.5 py-1 font-mono text-xs font-medium whitespace-nowrap text-muted">
        <span aria-hidden className="size-[7px] rounded-full bg-current" /> {t("room.notRecording")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[7px] rounded-md bg-accent-soft px-2.5 py-1 font-mono text-xs font-medium whitespace-nowrap text-accent-strong tabular-nums">
      <span aria-hidden className="size-[7px] animate-rec-pulse rounded-full bg-current" /> REC {clock}
    </span>
  );
}
