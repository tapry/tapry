"use client";

import { useT } from "@/lib/i18n/client";
import { checkStorage, requestPersistentStorage } from "@tapry/recorder";
import { NO_FILTERS, type SessionTicket, type StudioSettings, type TrackFilters } from "@tapry/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, cn, Field, Notice, RecDot, Select } from "@/components/ui";
import { apiFetch } from "@/lib/client/api";
import { estimateClock, type ClockEstimate } from "@/lib/client/clock";
import { useFilterPrefs } from "@/lib/client/filters";
import { useBackgroundBlur } from "@/lib/client/person-mask";
import { useDevices, useLocalMedia, useMicLevel, useStoredState, type Devices } from "@/lib/media/hooks";
import { FiltersPanel, filtersOn, useFiltersPanel } from "./filters-panel";
import { eqAnimation, Icon, ICON } from "./icons";
import { SelfVideo } from "./self-video";
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
  /** A host who joins without being recorded: in the call and at the controls only. */
  producer?: boolean;
}

/**
 * Check camera, mic and browser before entering. The stream opened here is handed
 * to the room as-is, so guests don't see a second permission prompt or a flicker.
 */
export function GreenRoom({ ticket, onJoin }: { ticket: SessionTicket; onJoin: (ready: ReadyToJoin) => void }) {
  const { t } = useT();
  const settings = ticket.studio.settings;
  // Key named before the rename to Tapry, so saved device choices carry over.
  const [choice, setChoice] = useStoredState<DeviceChoice>("devices", { headphones: false });
  const constraints = useMemo(() => buildConstraints(settings, choice), [settings, choice]);
  const { stream, status, problem, retry, handOff } = useLocalMedia(constraints);
  const devices = useDevices(status); // re-list once permission makes labels visible
  const level = useMicLevel(stream);
  const [checks, setChecks] = useState<Check[]>([]);
  const [clock, setClock] = useState<ClockEstimate | null>(null);
  const [joining, setJoining] = useState(false);
  const [measuring, setMeasuring] = useState(true);
  // How this person looks and sounds to the others and in the files; the stream opened here stays untouched.
  const [prefs, setPrefs] = useFilterPrefs();
  const filtersPanel = useFiltersPanel(false);
  const hasPicture = !settings.audioOnly && !choice.cameraOff && !!stream && stream.getVideoTracks().length > 0;
  // Background blur: works out where the person is from its own copy of the camera, here already,
  // so it is ready (and they have seen it) before they go in.
  const blur = useBackgroundBlur(hasPicture ? stream : null, prefs);

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
      setMeasuring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [producer, setProducer] = useState(false);
  const [producerProblem, setProducerProblem] = useState(false);
  const blocking = checks.some((c) => c.tone === "danger");
  // Waits for the clock estimate: without it this person's recording is placed by their own clock.
  const canJoin = status === "live" && !!stream && !!clock && !blocking && !joining;

  async function join() {
    if (!stream) return;
    setJoining(true);
    // Ask the browser not to evict the local backup under disk pressure. Never wait for the
    // answer: Firefox shows a prompt and the promise stays pending until the guest responds,
    // which would block joining for anyone who ignores it.
    void requestPersistentStorage().catch(() => false);
    // The room owns the stream from here; the green room must not stop it on unmount.
    // The server is told first: it refuses a producer's tracks, and the others see who isn't recorded.
    if (ticket.role === "host") {
      const ok = await apiFetch(`/sessions/${ticket.sessionId}/producer`, { method: "PUT", body: { producer }, token: ticket.token }).then(
        () => true,
        () => false,
      );
      if (!ok) {
        setJoining(false);
        setProducerProblem(true);
        return;
      }
    }
    onJoin({ stream: handOff() ?? stream, choice, clock, producer: ticket.role === "host" && producer });
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-[18px]">
      <div className="flex flex-col gap-3">
        <Preview
          stream={stream}
          cameraOff={!!choice.cameraOff}
          audioOnly={settings.audioOnly}
          failed={status === "error"}
          level={{ db: level.rmsDb, state: level.state, live: status === "live", suspended: level.suspended }}
          onToggleCamera={() => setChoice({ ...choice, cameraOff: !choice.cameraOff })}
          filters={prefs.filters}
          mirror={prefs.mirror}
          controls={
            status === "live" && (
              <button
                ref={filtersPanel.button}
                type="button"
                onClick={filtersPanel.toggle}
                aria-expanded={filtersPanel.open}
                aria-controls="green-room-filters"
                aria-label={filtersOn(prefs.filters, hasPicture) ? t("filters.titleOn") : t("filters.title")}
                title={t("filters.title")}
                className={cn(
                  "relative grid size-9 cursor-pointer place-items-center rounded-full text-white transition-colors",
                  filtersPanel.open ? "bg-black/80" : "bg-black/55 hover:bg-black/70",
                )}
              >
                <Icon d={ICON.sliders} />
                {filtersOn(prefs.filters, hasPicture) && <FilterDot />}
              </button>
            )
          }
        />
        {filtersPanel.open && (
          <FiltersPanel
            id="green-room-filters"
            panelRef={filtersPanel.panel}
            prefs={prefs}
            onChange={setPrefs}
            hasCamera={hasPicture}
            blur={blur}
            tone="page"
            onClose={filtersPanel.close}
            className="animate-fade-up"
          />
        )}
        <LevelAdvice state={level.state} live={status === "live"} suspended={level.suspended} />
        {problem && (
          <Notice tone="danger">
            <p className="font-medium">{t(`media.${problem.code}.title`)}</p>
            <p className="mt-1">{t(`media.${problem.code}.help`)}</p>
            <Button variant="secondary" className="mt-3" onClick={retry}>
              {t("common.tryAgain")}
            </Button>
          </Notice>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-[18px]">
        <DevicePickers settings={settings} devices={devices} choice={choice} setChoice={setChoice} />

        <HeadphonesBox checked={choice.headphones} onChange={(headphones) => setChoice({ ...choice, headphones })}>
          {t("gr.wearing")}
        </HeadphonesBox>

        {ticket.role === "host" && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-[1.45] text-text-2">
            <input type="checkbox" checked={producer} onChange={(e) => setProducer(e.target.checked)} className="mt-0.5 size-4 shrink-0" data-testid="join-as-producer" />
            <span>Join as producer: I&apos;m in the call and at the controls, but I&apos;m not recorded and not in the files.</span>
          </label>
        )}
        {producerProblem && <Notice tone="danger">That couldn&apos;t be changed right now (a recording of you may be running). Try again.</Notice>}

        <CheckList checks={checks} pending={measuring ? [t("gr.checking")] : []} />

        <Button variant="record" className="w-full" disabled={!canJoin} onClick={join}>
          <RecDot />
          {ticket.role === "host" ? t("gr.enter") : t("gr.join")}
        </Button>
        {status === "live" && !clock ? (
          <p className="-mt-1.5 text-center text-xs text-muted">{t("gr.checkingConnection")}</p>
        ) : (
          status === "live" &&
          level.state !== "good" && <p className="-mt-1.5 text-center text-xs text-muted">{t("gr.joinAnyway")}</p>
        )}
      </div>
    </div>
  );
}

/** "I'm wearing headphones": a plain checkbox line, as in the designs. Also used by the tech check. */
export function HeadphonesBox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-[1.45] text-text-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </label>
  );
}

/** Microphone and camera pickers (no camera in an audio-only studio). Also used by the tech check. */
export function DevicePickers({
  settings,
  devices,
  choice,
  setChoice,
}: {
  settings: StudioSettings;
  devices: Devices;
  choice: DeviceChoice;
  setChoice: (c: DeviceChoice) => void;
}) {
  const { t } = useT();
  return (
    <>
      <Field label={t("gr.microphone")}>
        <Select
          value={choice.audioDeviceId ?? ""}
          onChange={(e) => setChoice({ ...choice, audioDeviceId: e.target.value || undefined })}
        >
          <option value="">{t("gr.systemDefault")}</option>
          {devices.audioInputs
            .filter((d) => d.deviceId !== "default")
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t("gr.microphoneN", { n: i + 1 })}
              </option>
            ))}
        </Select>
      </Field>
      {!settings.audioOnly && (
        <Field label={t("gr.camera")}>
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
            <option value="">{t("gr.systemDefault")}</option>
            {devices.videoInputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t("gr.cameraN", { n: i + 1 })}
              </option>
            ))}
            <option value="off">{t("gr.cameraOffOption")}</option>
          </Select>
        </Field>
      )}
    </>
  );
}

/** The list of checks, each with a ✓ or a warning sign; a spinner for what's still being measured. */
export function CheckList({
  checks,
  pending = [],
}: {
  checks: Check[];
  pending?: string[];
}) {
  const { t } = useT();
  return (
    <ul className="flex flex-col gap-[9px] border-t border-divider pt-3.5 text-sm" aria-label={t("gr.checks")}>
      {checks.length === 0 && pending.length === 0 && (
        <li className="flex items-start gap-[9px] text-muted">
          <Icon d={ICON.loader} className="mt-0.5 animate-spin-fast" />
          Checking your browser…
        </li>
      )}
      {checks.map((c) => (
        <li
          key={c.id}
          data-check={c.id}
          data-tone={c.tone}
          className={cn(
            "flex items-start gap-[9px] animate-fade-up",
            c.tone === "ok" ? "text-text-2" : c.tone === "warn" ? "text-warn-strong" : "text-accent-strong",
          )}
        >
          <Icon
            d={c.tone === "ok" ? ICON.checkCircle : ICON.alert}
            className={cn("mt-0.5", c.tone === "ok" ? "text-ok" : c.tone === "warn" ? "text-warn" : "text-accent")}
          />
          {c.msg ? t(...c.msg) : c.label}
        </li>
      ))}
      {pending.map((label) => (
        <li key={label} className="flex items-start gap-[9px] text-muted">
          <Icon d={ICON.loader} className="mt-0.5 animate-spin-fast" />
          {label}
        </li>
      ))}
    </ul>
  );
}

type LevelState = keyof typeof LEVEL_ADVICE;

/** Above this share of the meter, someone's talking: the pill's rings and bars come alive. */
const TALKING_FRACTION = 0.35;

/**
 * The camera preview on the dark stage, with the microphone level pill (the meter) bottom left
 * and a camera on/off button bottom right. The call stage is dark in both themes.
 */
export function Preview({
  stream,
  cameraOff,
  audioOnly,
  failed,
  level,
  onToggleCamera,
  filters = NO_FILTERS,
  mirror = true,
  controls,
}: {
  stream: MediaStream | null;
  cameraOff: boolean;
  audioOnly: boolean;
  failed: boolean;
  level?: { db: number; state: LevelState; live: boolean; suspended: boolean };
  onToggleCamera?: () => void;
  /** This person's picture filters and mirror choice, shown on the preview only (the stream stays as it is). */
  filters?: TrackFilters;
  mirror?: boolean;
  /** More round buttons for the bottom right corner, before the camera one (Filters). */
  controls?: React.ReactNode;
}) {
  const { t } = useT();
  const hasCamera = !!stream && stream.getVideoTracks().length > 0;
  const hasVideo = hasCamera && !cameraOff;
  const fraction = level ? meterFraction(level.db) : 0;
  const talking = !!level?.live && !level.suspended && fraction > TALKING_FRACTION;
  return (
    // Dark in both themes, so the focus ring is light here.
    <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-[#18181b] [--ring:#fafafa]">
      <SelfVideo
        stream={stream}
        filters={hasVideo ? filters : NO_FILTERS}
        mirror={mirror}
        className={cn("transition-opacity duration-300", !hasVideo && "opacity-0")}
      />
      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center px-5 text-center text-[14.5px] text-white">
          {audioOnly
            ? t("gr.soundOnlyStudio")
            : cameraOff
              ? t("gr.cameraOff")
              : stream
                ? t("gr.noCamera")
                : failed
                  ? t("gr.cameraUnavailable")
                  : t("gr.startingCamera")}
        </div>
      )}
      {level && (
        <span className="absolute bottom-3 left-3 flex items-center gap-2.5 rounded-full bg-black/60 py-1.5 pr-3 pl-2 text-white backdrop-blur-md">
          <span className="relative grid size-[22px] place-items-center">
            {talking && (
              <>
                <span aria-hidden className="absolute inset-0 animate-ring rounded-full border-2 border-accent" />
                <span aria-hidden className="absolute inset-0 animate-ring rounded-full border-2 border-accent [animation-delay:.6s]" />
              </>
            )}
            <span className="relative grid size-[22px] place-items-center rounded-full bg-accent text-accent-text">
              <Icon d={ICON.mic} className="size-[11px]" />
            </span>
          </span>
          <span
            role="meter"
            aria-label={t("gr.micLevel")}
            aria-valuemin={-60}
            aria-valuemax={0}
            aria-valuenow={Math.round(Math.max(-60, level.db))}
            className="flex h-4 items-center gap-0.5 transition-transform duration-75"
            style={{ transform: talking ? `scaleY(${Math.max(0.45, fraction).toFixed(2)})` : undefined }}
          >
            {Array.from({ length: 12 }, (_, k) => (
              <span
                key={k}
                className="h-4 w-[3px] rounded-[2px] bg-white"
                style={{ transform: "scaleY(.25)", animation: talking ? eqAnimation(k) : "none" }}
              />
            ))}
          </span>
          <span className="text-[12.5px] whitespace-nowrap">
            {!level.live ? (failed ? t("gr.noMic") : t("gr.starting")) : level.suspended ? t("gr.clickToStart") : t(`level.short.${level.state}`)}
          </span>
        </span>
      )}
      {/*
        Same choice as "Camera off (audio only)" in the picker: it decides whether a camera is opened
        for the whole session, so it says so (it is not the room's camera on/off). Not offered when
        there is no camera to choose. The words avoid "camera": that is the picker's label.
      */}
      <span className="absolute right-3 bottom-3 flex items-center gap-2 empty:hidden">
        {controls}
        {onToggleCamera && !audioOnly && stream && (hasCamera || cameraOff) && (
          <button
            type="button"
            onClick={onToggleCamera}
            aria-label={cameraOff ? t("gr.withVideo") : t("gr.withoutVideo")}
            title={cameraOff ? t("gr.withVideo") : t("gr.withoutVideo")}
            className={cn(
              "grid size-9 cursor-pointer place-items-center rounded-full transition-colors",
              cameraOff ? "bg-accent text-accent-text hover:bg-accent-hover" : "bg-black/55 text-white hover:bg-black/70",
            )}
          >
            <Icon d={cameraOff ? ICON.camOff : ICON.cam} />
          </button>
        )}
      </span>
    </div>
  );
}

/** The small terracotta dot on a Filters button: something is on. */
export function FilterDot() {
  return <span aria-hidden data-testid="filters-on" className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-[#18181b] bg-accent" />;
}

/** Under the preview: what to do about the level, when it isn't right yet. */
export function LevelAdvice({ state, live, suspended }: { state: LevelState; live: boolean; suspended: boolean }) {
  const { t } = useT();
  if (!live || (state === "good" && !suspended)) return null;
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-[13.5px] leading-[1.45]",
        suspended ? "text-muted" : state === "clipping" ? "text-accent-strong" : "text-warn-strong",
      )}
    >
      <Icon d={suspended ? ICON.mic : ICON.alert} className="mt-0.5 size-[15px]" />
      {suspended ? t("gr.clickAnywhere") : `${t(`level.advice.${state}`)} ${t("gr.sayWords")}`}
    </p>
  );
}
