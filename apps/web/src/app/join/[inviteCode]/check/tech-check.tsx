"use client";

import { checkStorage } from "@tapry/recorder";
import type { StudioSettings, TechCheckResult } from "@tapry/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { estimateClock } from "@/lib/client/clock";
import { describeBrowser, measureUpload, uploadCheck } from "@/lib/client/tech-check";
import { useDevices, useLocalMedia, useMicLevel, useStoredState } from "@/lib/media/hooks";
import { useT } from "@/lib/i18n/client";
import { browserChecks, buildConstraints, currentBrowserEnv, networkCheck, storageCheck, type Check, type DeviceChoice } from "@/lib/media/media";
import { CheckList, DevicePickers, HeadphonesBox, LevelAdvice, Preview } from "../../../session/[sessionId]/green-room";
import { Icon, ICON } from "../../../session/[sessionId]/icons";

const SAMPLE_SECONDS = 5;

/**
 * The guest tech check: the green room's checks plus an upload-speed test and a short test
 * recording played back on the spot. Nothing is recorded for the studio; the results go to the
 * host only when the guest sends them.
 */
export function TechCheck({ inviteCode, hostName, settings }: { inviteCode: string; hostName: string; settings: StudioSettings }) {
  // Same saved devices as the green room, so what works here is what they'll join with.
  const [choice, setChoice] = useStoredState<DeviceChoice>("devices", { headphones: false });
  const constraints = useMemo(() => buildConstraints(settings, choice), [settings, choice]);
  const { stream, status, problem, retry } = useLocalMedia(constraints);
  const devices = useDevices(status);
  const level = useMicLevel(stream);
  const [heard, setHeard] = useState(false);
  useEffect(() => {
    if (level.state === "good" || level.state === "clipping") setHeard(true);
  }, [level.state]);

  // Browser, disk, connection and upload speed: measured once, in the background.
  const { t } = useT();
  const [background, setBackground] = useState<Check[]>([]);
  const [testing, setTesting] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const base = browserChecks(currentBrowserEnv());
    setBackground(base);
    (async () => {
      const disk = await checkStorage().catch(() => null);
      const clock = await estimateClock(async () => (await apiFetch<{ serverTime: number }>("/time")).serverTime).catch(() => null);
      if (cancelled) return;
      setBackground([...base, storageCheck(disk?.freeBytes ?? null, disk?.ok ?? true), networkCheck(clock?.rttMs ?? null)]);
      const mbps = await measureUpload(`/api/check/${encodeURIComponent(inviteCode)}/upload`);
      if (cancelled) return;
      setBackground([...base, storageCheck(disk?.freeBytes ?? null, disk?.ok ?? true), networkCheck(clock?.rttMs ?? null), uploadCheck(mbps, settings)]);
      setTesting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode, settings]);

  const [sampleOk, setSampleOk] = useState<boolean | null>(null);
  const checks: Check[] = [...deviceChecks(), ...background];
  if (sampleOk !== null) {
    checks.push(
      sampleOk
        ? { id: "playback", tone: "ok", label: "Sounded clear on the test recording", msg: ["chk.playbackOk"] }
        : { id: "playback", tone: "warn", label: "The test recording didn't sound right. Try another microphone above.", msg: ["chk.playbackBad"] },
    );
  }

  function deviceChecks(): Check[] {
    if (status === "error") return [{ id: "devices", tone: "danger", label: problem?.title ?? "Camera or microphone unavailable", msg: [problem ? `media.${problem.code}.title` : "chk.devicesBad"] }];
    if (status !== "live" || !stream) return [];
    const out: Check[] = [];
    if (!settings.audioOnly) {
      out.push(
        stream.getVideoTracks().length > 0
          ? { id: "camera", tone: "ok", label: "Camera works", msg: ["chk.cameraOk"] }
          : { id: "camera", tone: "ok", label: "Camera off: you'll be recorded with sound only", msg: ["chk.cameraOff"] },
      );
    }
    out.push(
      heard
        ? { id: "mic", tone: "ok", label: "Microphone picks you up", msg: ["chk.micOk"] }
        : { id: "mic", tone: "warn", label: "We haven't heard you yet. Say a few words.", msg: ["chk.micWait"] },
    );
    out.push(
      choice.headphones
        ? { id: "headphones", tone: "ok", label: "Wearing headphones", msg: ["chk.headphonesOk"] }
        : { id: "headphones", tone: "warn", label: "No headphones: the others' voices may leak into your recording", msg: ["chk.headphonesNo"] },
    );
    return out;
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
        />
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
        <HearYourself stream={stream} onAnswer={setSampleOk} answered={sampleOk} />
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-[18px]">
        <DevicePickers settings={settings} devices={devices} choice={choice} setChoice={setChoice} />
        <HeadphonesBox checked={choice.headphones} onChange={(headphones) => setChoice({ ...choice, headphones })}>
          {t("check.willWear")}
        </HeadphonesBox>
        <CheckList
          checks={checks}
          pending={[...(status === "starting" ? [t("check.startingDevices")] : []), ...(testing ? [t("check.testingUpload")] : [])]}
        />
        <SendResults inviteCode={inviteCode} hostName={hostName} checks={checks} ready={!testing && status !== "starting"} />
      </div>
    </div>
  );
}

/** Record a few seconds locally and play them back, so the guest hears what the host will get. */
function HearYourself({
  stream,
  answered,
  onAnswer,
}: {
  stream: MediaStream | null;
  answered: boolean | null;
  onAnswer: (ok: boolean) => void;
}) {
  const { t } = useT();
  const [left, setLeft] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  function record() {
    const track = stream?.getAudioTracks()[0];
    if (!track || typeof MediaRecorder === "undefined") return;
    // A clone, so stopping it never touches the stream the meter (and later the room) uses.
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
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5" data-testid="hear-yourself">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Icon d={ICON.wave} className="size-[15px]" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t("check.hear")}</span>
            <span className="text-[13px] text-muted">{t("check.hearBody", { seconds: SAMPLE_SECONDS })}</span>
          </span>
        </span>
        <Button variant="secondary" onClick={record} disabled={!stream || left !== null}>
          {left !== null ? t("check.recordingLeft", { left }) : url ? t("check.recordAgain") : t("check.recordTest")}
        </Button>
      </div>
      {url && (
        <>
          <audio ref={audio} src={url} controls autoPlay className="w-full" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="me-1 text-text-2">{t("check.howSound")}</span>
            <Button variant={answered === true ? "primary" : "secondary"} onClick={() => onAnswer(true)}>
              {t("check.clear")}
            </Button>
            <Button variant={answered === false ? "primary" : "secondary"} onClick={() => onAnswer(false)}>
              {t("check.off")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The guest's name and the button that sends the results (only then do they leave the page). */
function SendResults({
  inviteCode,
  hostName,
  checks,
  ready,
}: {
  inviteCode: string;
  hostName: string;
  checks: Check[];
  ready: boolean;
}) {
  const { t } = useT();
  // The host reads the results in English, whatever language the guest reads them in.
  const report: TechCheckResult[] = checks.map(({ id, tone, label }) => ({ id, tone, label }));
  const [reportId] = useState(() => `chk_${crypto.randomUUID().replace(/-/g, "")}`);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/check/${encodeURIComponent(inviteCode)}/report`, {
        body: { reportId, name, browser: describeBrowser(navigator.userAgent), checks: report },
      });
      setSent(JSON.stringify(report));
    } catch (err) {
      setError(err instanceof ApiRequestError && err.code !== "network" ? err.message : t("check.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const changed = sent !== null && sent !== JSON.stringify(report);
  return (
    <form onSubmit={send} className="flex flex-col gap-3 border-t border-divider pt-3.5">
      <Field label={t("common.yourName")} hint={t("check.nameHint", { host: hostName })}>
        <Input name="name" autoComplete="name" required maxLength={60} />
      </Field>
      <Button type="submit" disabled={!ready || busy} className="w-full">
        {sent && !changed ? t("check.sent") : sent ? t("check.sendNew") : t("check.send", { host: hostName })}
      </Button>
      {sent && !changed && (
        <p className="flex items-start gap-2 text-[13.5px] leading-[1.45] text-ok-strong" data-testid="check-sent">
          <Icon d={ICON.checkCircle} className="mt-0.5 size-[15px]" />
          {t("check.sentBody", { host: hostName })}
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}
