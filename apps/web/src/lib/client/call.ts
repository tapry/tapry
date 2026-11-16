"use client";

import { hasVideoFilters, NO_FILTERS, type CallToken, type SessionTicket, type TrackFilters } from "@tapry/shared";
import {
  ConnectionState,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteVideoTrack,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import { deviceLine, diagFor, errorLine, isAppleWebKit, receivedVideoLine, sentFrames, sentVideoLine, type Note } from "./diag";
import { canPreviewFilters, startFilteredTrack, type FilteredTrack } from "./filter-picture";
import { getPersonMask } from "./person-mask";

export type CallStatus = "off" | "connecting" | "connected" | "reconnecting" | "failed";

export interface RemotePeer {
  /** Participant id (the LiveKit identity). */
  id: string;
  name: string;
  video?: RemoteVideoTrack;
  audio?: RemoteAudioTrack;
  /** What they are sharing from their screen, while they are. */
  screen?: RemoteVideoTrack;
  micMuted: boolean;
  cameraOff: boolean;
  speaking: boolean;
  /** They asked to be shown mirrored (from the session's state, not the call). */
  mirrored?: boolean;
}

export interface CallState {
  status: CallStatus;
  peers: RemotePeer[];
  localSpeaking: boolean;
  /** The browser blocked autoplay; call `startAudio` from a click. */
  audioBlocked: boolean;
}

const CALL_VIDEO = { width: 640, height: 360, frameRate: 24 };

/** What the call holds of this person: the published tracks, and the camera/mic copies behind them. */
interface LocalTracks {
  audio?: LocalAudioTrack;
  video?: LocalVideoTrack;
  /** The call's own copies (clones) of the mic and camera. Filters only ever touch these. */
  mic?: MediaStreamTrack;
  cam?: MediaStreamTrack;
  /** While the person has picture filters: the camera copy drawn with them, sent instead of it. */
  picture?: FilteredTrack;
  /** What a picture is drawn from: `cam`, or on Apple's WebKit the camera itself (only read, never stopped). */
  source?: MediaStreamTrack;
  /** Apple's WebKit: the call always sends a drawn picture, filters or not (see publishCamera). */
  alwaysPicture?: boolean;
  /** Noise removal on the mic copy: whether it is on, and what the copy had before. */
  noise?: { on: boolean; before: boolean | undefined };
  /** This browser can't give the mic copy its own noise removal: the live part is skipped. */
  noiseUnavailable?: boolean;
  /** Filter changes, one after the other. */
  chain?: Promise<void>;
  /** Stops reporting what the camera copy sends (diagnostics). */
  stopStats?: () => void;
  /** The call's copy of the shared screen, while one is shared. */
  screen?: LocalVideoTrack;
}

/**
 * The live call. It runs beside the recording and never touches it: what goes to
 * LiveKit are clones of the camera and mic tracks, scaled down for the call, so a
 * bad connection only degrades the call while the local recording stays full quality.
 * The person's filters are shown on those clones only (picture: drawn on a canvas; noise
 * removal: the browser's own, on the mic clone); the recorder's tracks are never involved.
 */
export function useCall(ticket: SessionTicket, stream: MediaStream, enabled: boolean, filters: TrackFilters = NO_FILTERS) {
  const [state, setState] = useState<CallState>({ status: "off", peers: [], localSpeaking: false, audioBlocked: false });
  const room = useRef<Room | null>(null);
  const local = useRef<LocalTracks>({});
  const wanted = useRef(filters);
  wanted.current = filters;
  /** The screen the person is sharing (the recorder's track: the call only ever gets a copy). */
  const sharing = useRef<MediaStreamTrack | null>(null);
  /** The running call's diagnostics, for the camera and mic switches too. */
  const noteRef = useRef<Note>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let current: Room | null = null;
    // What this device's call does, for the server's log (diag.ts): steps and errors, no media.
    const note = diagFor(ticket);
    noteRef.current = note;
    note("call.start", deviceLine());
    const camera = stream.getVideoTracks()[0];
    const cameraSays = (what: string) => () => note(`camera.${what}`);
    const onMute = cameraSays("muted_by_browser");
    const onUnmute = cameraSays("unmuted");
    const onEnded = cameraSays("ended");
    camera?.addEventListener("mute", onMute);
    camera?.addEventListener("unmute", onUnmute);
    camera?.addEventListener("ended", onEnded);
    const onVisibility = () => note(document.hidden ? "page.hidden" : "page.visible");
    document.addEventListener("visibilitychange", onVisibility);
    // What arrives of each person's picture: three times at first, then only when it stopped
    // moving (the tile then says "Picture interrupted"), so the log shows why.
    const heard = new Map<string, { times: number; decoded: number }>();
    const watchPictures = setInterval(() => {
      const r = current;
      if (!r || r.state !== ConnectionState.Connected) return;
      for (const p of r.remoteParticipants.values()) {
        const track = p.getTrackPublication(Track.Source.Camera)?.videoTrack as RemoteVideoTrack | undefined;
        if (!track) continue;
        void receivedVideoLine(track.receiver)
          .then(({ line, decoded }) => {
            const seen = heard.get(p.identity) ?? { times: 0, decoded: -2 };
            const stopped = seen.decoded >= 0 && decoded === seen.decoded;
            if (seen.times < 3 || stopped) note(stopped ? "call.peer_video_stopped" : "call.peer_video", `${p.identity}: ${line}`);
            heard.set(p.identity, { times: seen.times + 1, decoded });
          })
          .catch(() => {});
      }
    }, 10_000);

    // One retry at a time. A failure can surface twice (connect or publish throws, and the room
    // also emits Disconnected): two retries would join the same person twice, and LiveKit kicks
    // the older copy each time, so the copies would keep throwing each other out.
    const retryLater = (attempt: number) => {
      if (cancelled || retry !== undefined) return;
      retry = setTimeout(() => {
        retry = undefined;
        void connect(attempt);
      }, Math.min(10_000, 1000 * 2 ** (attempt - 1)));
    };

    const snapshot = (r: Room) => {
      if (cancelled) return;
      const peers = [...r.remoteParticipants.values()].map(toPeer);
      setState({
        status: statusOf(r.state),
        peers,
        localSpeaking: r.localParticipant.isSpeaking,
        audioBlocked: !r.canPlaybackAudio,
      });
    };

    const connect = async (attempt: number) => {
      note("call.connecting", `attempt ${attempt + 1}`);
      setState((s) => ({ ...s, status: attempt === 0 ? "connecting" : "reconnecting" }));
      // Drop the previous room completely before joining again.
      const previous = current;
      current = null;
      if (previous) {
        previous.removeAllListeners();
        void previous.disconnect();
      }
      // This effect's tracks: after cleanup, `local.current` is the next effect's.
      const tracks = local.current;
      try {
        const t = await apiFetch<CallToken>(`/sessions/${ticket.sessionId}/call-token`, { body: {}, token: ticket.token });
        if (cancelled) return;
        if (!t.enabled) {
          setState((s) => ({ ...s, status: "off" }));
          return;
        }
        // No adaptive stream: it pauses a person's picture whenever it decides their tile isn't
        // visible (a hidden tab, a tile being moved), and a paused tile looks like a broken guest.
        // The call's pictures are one small 360p stream each, so there is little to save.
        const r = new Room({ adaptiveStream: false, dynacast: true, stopLocalTrackOnUnpublish: true });
        current = r;
        room.current = r;
        const update = () => snapshot(r);
        for (const e of [
          RoomEvent.ParticipantConnected,
          RoomEvent.ParticipantDisconnected,
          RoomEvent.TrackSubscribed,
          RoomEvent.TrackUnsubscribed,
          // A screen share comes and goes while the call runs.
          RoomEvent.TrackPublished,
          RoomEvent.TrackUnpublished,
          RoomEvent.TrackMuted,
          RoomEvent.TrackUnmuted,
          RoomEvent.ActiveSpeakersChanged,
          RoomEvent.ConnectionStateChanged,
          RoomEvent.AudioPlaybackStatusChanged,
          RoomEvent.ParticipantNameChanged,
        ]) {
          r.on(e, update);
        }
        r.on(RoomEvent.ConnectionStateChanged, (s) => note("call.state", String(s)));
        r.on(RoomEvent.Disconnected, (reason) => {
          if (cancelled || r !== current) return;
          note("call.disconnected", `reason ${reason ?? "unknown"}`);
          snapshot(r);
          // LiveKit gave up reconnecting by itself: start over with a fresh token.
          retryLater(attempt + 1);
        });

        // ?relay=1: use only TURN-relayed connections. For checking that guests behind strict
        // firewalls can still join (and for tests); normal visits never set it.
        const relayOnly = new URLSearchParams(window.location.search).get("relay") === "1";
        await r.connect(t.url, t.token, relayOnly ? { rtcConfig: { iceTransportPolicy: "relay" } } : undefined);
        if (cancelled) return void r.disconnect();
        note("call.connected");
        releasePicture(tracks); // a rejoin starts from fresh clones
        await publish(r, stream, tracks, wanted.current, note);
        // Whatever changed while this was publishing (nothing to do when there are no filters).
        await syncFilters(tracks, stream, () => wanted.current);
        // Sharing a screen when the call (re)connected: the others get it again.
        await publishScreen(r, tracks, sharing.current).catch((err) => console.warn("[call] screen", err));
        if (cancelled) return releasePicture(tracks);
        snapshot(r);
      } catch (err) {
        releasePicture(tracks);
        if (cancelled) return;
        note("call.failed", errorLine(err));
        console.error("[call]", err);
        setState((s) => ({ ...s, status: "failed" }));
        retryLater(attempt + 1);
      }
    };
    void connect(0);

    return () => {
      cancelled = true;
      clearTimeout(retry);
      note("call.left");
      clearInterval(watchPictures);
      local.current.stopStats?.();
      camera?.removeEventListener("mute", onMute);
      camera?.removeEventListener("unmute", onUnmute);
      camera?.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibility);
      void current?.disconnect(); // stops the call clones only; the recording's tracks are untouched
      releasePicture(local.current);
      room.current = null;
      local.current = {};
    };
  }, [ticket, stream, enabled]);

  // The person changed their filters: show them on the call's copies.
  useEffect(() => {
    void syncFilters(local.current, stream, () => wanted.current);
  }, [filters, stream]);

  const startAudio = useCallback(() => void room.current?.startAudio(), []);

  /** Mute means muted everywhere: in the call and in the recording. */
  const setMicMuted = useCallback(
    async (muted: boolean) => {
      for (const t of stream.getAudioTracks()) t.enabled = !muted;
      const audio = local.current.audio;
      if (audio) await (muted ? audio.mute() : audio.unmute());
    },
    [stream],
  );

  const setCameraOff = useCallback(
    async (off: boolean) => {
      for (const t of stream.getVideoTracks()) t.enabled = !off;
      const tracks = local.current;
      const video = tracks.video;
      const note = noteRef.current;
      note(off ? "call.camera_off" : "call.camera_on");
      if (video) await (off ? video.mute() : video.unmute());
      // With picture filters the call sends the canvas, not the camera copy: keep the copy in step.
      if (tracks.picture && tracks.cam) tracks.cam.enabled = !off;
    },
    [stream],
  );

  /**
   * Show the others this screen (null: stop). The call sends a small copy; the track itself is
   * the recorder's and is never constrained or stopped here. Without a call nothing is sent.
   */
  const setScreen = useCallback(async (track: MediaStreamTrack | null) => {
    sharing.current = track;
    const r = room.current;
    if (r?.state === ConnectionState.Connected) await publishScreen(r, local.current, track).catch((err) => console.warn("[call] screen", err));
  }, []);

  return { ...state, startAudio, setMicMuted, setCameraOff, setScreen };
}

/** What the call sends of a shared screen: readable text matters more than motion. */
const CALL_SCREEN = { height: 1080, frameRate: 12, maxBitrate: 1_500_000 };

/** Replace the call's copy of the shared screen with a copy of `track` (null: just remove it). */
async function publishScreen(r: Room, local: LocalTracks, track: MediaStreamTrack | null) {
  const previous = local.screen;
  local.screen = undefined;
  // Unpublishing stops the copy (stopLocalTrackOnUnpublish), never the screen track it was cloned from.
  if (previous) await r.localParticipant.unpublishTrack(previous).catch(() => {});
  if (!track || track.readyState !== "live") return;
  const clone = track.clone();
  clone.contentHint = "detail";
  await clone.applyConstraints({ height: { ideal: CALL_SCREEN.height }, frameRate: { max: CALL_SCREEN.frameRate } }).catch(() => {});
  const published = new LocalVideoTrack(clone, undefined, true);
  local.screen = published;
  await r.localParticipant.publishTrack(published, {
    source: Track.Source.ScreenShare,
    simulcast: false,
    videoEncoding: { maxBitrate: CALL_SCREEN.maxBitrate, maxFramerate: CALL_SCREEN.frameRate },
  });
}

async function publish(r: Room, stream: MediaStream, local: LocalTracks, filters: TrackFilters, note: Note) {
  const mic = stream.getAudioTracks()[0];
  const cam = stream.getVideoTracks()[0];
  if (mic) {
    const clone = mic.clone();
    clone.enabled = mic.enabled;
    local.mic = clone;
    local.noise = undefined;
    local.audio = new LocalAudioTrack(clone, undefined, true);
    await r.localParticipant.publishTrack(local.audio, { source: Track.Source.Microphone, dtx: true, red: true });
    note("call.audio_published");
  }
  if (cam) await publishCamera(r, cam, local, filters, note);
}

/** What the camera copy is sending, a few times early on and then every minute: for the log only. */
function reportSent(video: LocalVideoTrack, note: Note) {
  const at = [5_000, 15_000, 30_000, 60_000];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let step = 0;
  const next = () => {
    const wait = step < at.length ? at[step]! - (at[step - 1] ?? 0) : 60_000;
    step++;
    timer = setTimeout(() => {
      void sentVideoLine(video.sender)
        .then((line) => note("call.video_sent", line))
        .catch(() => {})
        .finally(() => {
          if (timer !== undefined) next();
        });
    }, wait);
  };
  next();
  // Whether the picture keeps going out: said once when it stops (and again when it starts),
  // with the line that shows why. Not while the camera is off or the page is in the background.
  let last: number | null = null;
  let still = 0;
  let stalled = false;
  const watch = setInterval(() => {
    if (video.isMuted || document.hidden) {
      still = 0;
      last = null;
      return;
    }
    void sentFrames(video.sender)
      .then((n) => {
        if (n === null) return;
        still = last !== null && n === last ? still + 1 : 0;
        last = n;
        if (still >= 2 && !stalled) {
          stalled = true;
          void sentVideoLine(video.sender).then((line) => note("call.video_stalled", line), () => {});
        } else if (still === 0 && stalled) {
          stalled = false;
          note("call.video_flowing");
        }
      })
      .catch(() => {});
  }, 3000);
  return () => {
    clearTimeout(timer);
    timer = undefined;
    clearInterval(watch);
  };
}

/**
 * Apple's WebKit (every iPhone and iPad browser, and Safari): the call is sent a picture drawn on
 * a canvas from the camera itself, filters or not. A copy (clone) of the camera stopped getting
 * frames there a few seconds into the call, while the camera itself, the person's own view and
 * the recording went on (the call diagnostics: frames encoded stuck at 150, then 812; owner's
 * test, 16 Nov 2026). The canvas is drawn at the call's size, so the encoder gets a small picture.
 * The camera is only read here: never sized, disabled or stopped by the call.
 */
async function publishDrawnCamera(r: Room, cam: MediaStreamTrack, local: LocalTracks, filters: TrackFilters, note: Note) {
  for (let attempt = 1; attempt <= CAMERA_TRIES; attempt++) {
    if (r.state !== ConnectionState.Connected) return;
    const began = performance.now();
    const picture = filteredCopy(cam, drawable(filters), true);
    let video: LocalVideoTrack | undefined;
    try {
      local.source = cam;
      local.alwaysPicture = true;
      local.picture = picture;
      video = new LocalVideoTrack(picture.track, undefined, true);
      local.video = video;
      await r.localParticipant.publishTrack(video, {
        source: Track.Source.Camera,
        simulcast: false,
        videoEncoding: { maxBitrate: 600_000, maxFramerate: CALL_VIDEO.frameRate },
      });
      const s = cam.getSettings();
      note("call.video_published", `try ${attempt}, ${Math.round(performance.now() - began)} ms, drawn from ${s.width ?? "?"}x${s.height ?? "?"}`);
      local.stopStats?.();
      local.stopStats = reportSent(video, note);
      return;
    } catch (err) {
      note("call.video_publish_failed", `try ${attempt}, drawn: ${errorLine(err)}`);
      console.warn("[call] camera", err);
      if (video) await r.localParticipant.unpublishTrack(video).catch(() => {});
      picture.stop();
      if (local.picture === picture) local.picture = undefined;
      if (local.video === video) local.video = undefined;
      if (attempt < CAMERA_TRIES) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  note("call.video_given_up");
}

/** How many times the camera is offered to a call before it carries on with sound only. */
const CAMERA_TRIES = 3;
/** Longer than this and a camera copy that won't take its size is published as it is. */
const SIZE_WAIT_MS = 2000;

/**
 * The camera's place in the call. It never throws: a camera that can't be published must not
 * take the sound down with it, so the call stays up and the camera is offered again a few
 * times. (It used to fail the whole call, which then left and rejoined every ten seconds on
 * an iPhone whose camera wouldn't publish: seen in the call server's log, 16 Nov 2026.)
 */
async function publishCamera(r: Room, cam: MediaStreamTrack, local: LocalTracks, filters: TrackFilters, note: Note) {
  // Apple's WebKit has one capture for every copy of a camera: asking this copy for a small
  // size can change or stall the camera the recorder is using. There the encoder scales instead.
  const shared = typeof navigator !== "undefined" && isAppleWebKit(navigator.userAgent, navigator.maxTouchPoints);
  if (shared) return publishDrawnCamera(r, cam, local, filters, note);
  for (let attempt = 1; attempt <= CAMERA_TRIES; attempt++) {
    if (r.state !== ConnectionState.Connected) return;
    const began = performance.now();
    const took = () => `${Math.round(performance.now() - began)} ms`;
    const clone = cam.clone();
    clone.enabled = cam.enabled;
    let video: LocalVideoTrack | undefined;
    try {
      // Scales only the clone; the original keeps recording at full resolution.
      const sized = shared
        ? "left to the encoder"
        : await Promise.race([
            clone
              .applyConstraints({ width: { ideal: CALL_VIDEO.width }, height: { ideal: CALL_VIDEO.height }, frameRate: { max: CALL_VIDEO.frameRate } })
              .then(() => "applied", () => "refused"),
            new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), SIZE_WAIT_MS)),
          ]);
      local.cam = clone;
      local.source = clone;
      // With picture filters, the others never see the plain picture, not even for a moment.
      if (hasVideoFilters(filters) && canPreviewFilters()) local.picture = filteredCopy(clone, filters);
      video = new LocalVideoTrack(local.picture?.track ?? clone, undefined, true);
      local.video = video;
      await r.localParticipant.publishTrack(video, {
        source: Track.Source.Camera,
        simulcast: false,
        videoEncoding: { maxBitrate: 600_000, maxFramerate: CALL_VIDEO.frameRate },
      });
      // Firefox ignores those constraints on a cloned camera track and keeps its full size, and
      // on Apple's WebKit they are never asked. Then the encoder scales the call's copy down
      // instead (the camera itself is left alone), by its short side, so a phone held upright
      // (2160x3840) becomes 360x640. The filtered picture is at the call's size already.
      const settings = clone.getSettings();
      const short = local.picture ? 0 : Math.min(settings.width ?? 0, settings.height ?? 0);
      if (short > CALL_VIDEO.height * 1.1) await scaleDown(video, short / CALL_VIDEO.height);
      note(
        "call.video_published",
        `try ${attempt}, ${took()}, ${settings.width ?? "?"}x${settings.height ?? "?"}, size ${sized}${local.picture ? ", filtered" : ""}${clone.muted ? ", copy muted" : ""}`,
      );
      local.stopStats?.();
      local.stopStats = reportSent(video, note);
      clone.addEventListener("mute", () => note("call.video_copy_muted"));
      clone.addEventListener("unmute", () => note("call.video_copy_unmuted"));
      clone.addEventListener("ended", () => note("call.video_copy_ended"));
      return;
    } catch (err) {
      note("call.video_publish_failed", `try ${attempt}, ${took()}: ${errorLine(err)}`);
      console.warn("[call] camera", err);
      // Leave nothing half-published behind, then offer it again with a fresh copy.
      if (video) await r.localParticipant.unpublishTrack(video).catch(() => {});
      releasePicture(local);
      clone.stop();
      if (local.video === video) local.video = undefined;
      if (local.cam === clone) local.cam = undefined;
      if (attempt < CAMERA_TRIES) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  note("call.video_given_up");
}

// ── Filters on the call's copies ─────────────────────────────────────────────

const filteredCopy = (source: MediaStreamTrack, filters: TrackFilters, inPage = false) =>
  // Background blur uses the mask the room keeps running (person-mask.ts); until there is one, the whole picture is blurred.
  startFilteredTrack(source, { maxHeight: CALL_VIDEO.height, frameRate: CALL_VIDEO.frameRate, filters, mask: getPersonMask, inPage });

/** The filters a drawn picture can show here: none where the canvas can't draw them. */
const drawable = (filters: TrackFilters) => (hasVideoFilters(filters) && canPreviewFilters() ? filters : NO_FILTERS);

/** Stops the canvas picture, and the camera copy behind it (LiveKit only stops the track it holds). */
function releasePicture(local: LocalTracks) {
  if (!local.picture) return;
  local.picture.stop();
  local.picture = undefined;
  // The call's own copy only: on Apple's WebKit the picture is drawn from the camera itself,
  // which is the recorder's and is never stopped here.
  local.cam?.stop();
  local.alwaysPicture = undefined;
}

/**
 * Brings the call's copies in line with the person's filters: one change after the other, each
 * reading the latest choice when its turn comes. Without filters, and none before, it does nothing.
 */
function syncFilters(local: LocalTracks, stream: MediaStream, latest: () => TrackFilters) {
  local.chain = (local.chain ?? Promise.resolve())
    .then(async () => {
      const filters = latest();
      await syncPicture(local, filters);
      await syncNoise(local, stream, filters.noiseRemoval);
    })
    .catch((err) => console.warn("[call] could not show the filters in the call", err));
  return local.chain;
}

async function syncPicture(local: LocalTracks, filters: TrackFilters) {
  const { video, cam } = local;
  // Apple's WebKit: always a drawn picture; only what it is drawn with changes.
  if (local.alwaysPicture) return local.picture?.setFilters(drawable(filters));
  if (!video || !cam || !video.sender) return;
  const want = hasVideoFilters(filters) && canPreviewFilters() && cam.readyState === "live";
  if (want && local.picture) return local.picture.setFilters(filters);
  if (want) {
    const picture = filteredCopy(cam, filters);
    cam.enabled = !video.isMuted;
    try {
      await video.replaceTrack(picture.track, true); // the camera copy keeps running, into the canvas
    } catch (err) {
      picture.stop();
      throw err;
    }
    if (local.video !== video) return picture.stop(); // the call was rejoined meanwhile
    local.picture = picture;
    await scaleDown(video, 1);
  } else if (local.picture) {
    // Back to no filters: the plain copy again, exactly as it is published without filters.
    const picture = local.picture;
    await video.replaceTrack(cam, true);
    picture.stop();
    if (local.picture === picture) local.picture = undefined;
    const height = cam.getSettings().height ?? 0;
    if (height > CALL_VIDEO.height * 1.1) await scaleDown(video, height / CALL_VIDEO.height);
  }
}

/**
 * Noise removal in the call: the browser's own noise suppression, asked for on the mic's clone.
 * Whether a clone can have its own setting depends on the browser, so the recorder's track is
 * checked before and after: if it changed with the clone, or the clone didn't take the setting,
 * the clone is put back and the live part is skipped on this device (the files still get it).
 * The recorder's track itself is never constrained here.
 */
async function syncNoise(local: LocalTracks, stream: MediaStream, on: boolean) {
  const clone = local.mic;
  const original = stream.getAudioTracks()[0];
  if (!clone || clone.readyState !== "live" || local.noiseUnavailable) return;
  if (!on && !local.noise?.on) return;
  if (on && local.noise?.on) return;
  if (!on) {
    const before = local.noise!.before;
    local.noise = { on: false, before };
    await clone.applyConstraints({ ...clone.getConstraints(), noiseSuppression: before ?? false }).catch(() => {});
    return;
  }
  const before = clone.getSettings().noiseSuppression;
  if (before === true) return; // already on for this mic (the studio's echo setting): nothing to add
  const recorderBefore = original?.getSettings().noiseSuppression;
  const applied = await clone.applyConstraints({ ...clone.getConstraints(), noiseSuppression: true }).then(
    () => true,
    () => false,
  );
  const took = applied && clone.getSettings().noiseSuppression === true;
  const leaked = !!original && original.getSettings().noiseSuppression !== recorderBefore;
  if (took && !leaked) {
    local.noise = { on: true, before };
    return;
  }
  local.noiseUnavailable = true;
  // Undo on the clone only; where the two share one setting, that puts the recorder's back too.
  if (applied) await clone.applyConstraints({ ...clone.getConstraints(), noiseSuppression: before ?? false }).catch(() => {});
}

async function scaleDown(track: LocalVideoTrack, factor: number) {
  const sender = track.sender;
  if (!sender) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    for (const e of params.encodings) e.scaleResolutionDownBy = factor;
    await sender.setParameters(params);
  } catch (err) {
    console.warn("[call] could not scale the call video down", err);
  }
}

function toPeer(p: RemoteParticipant): RemotePeer {
  const cam = p.getTrackPublication(Track.Source.Camera);
  const mic = p.getTrackPublication(Track.Source.Microphone);
  return {
    id: p.identity,
    name: p.name || "Guest",
    video: cam?.videoTrack as RemoteVideoTrack | undefined,
    audio: mic?.audioTrack as RemoteAudioTrack | undefined,
    screen: remoteScreen(p),
    micMuted: !mic || mic.isMuted,
    cameraOff: !cam || cam.isMuted,
    speaking: p.isSpeaking,
  };
}

/** The screen someone is sharing right now: published, not muted, and arriving. */
function remoteScreen(p: RemoteParticipant) {
  const pub = p.getTrackPublication(Track.Source.ScreenShare);
  if (!pub || pub.isMuted || !pub.videoTrack || pub.videoTrack.mediaStreamTrack.readyState !== "live") return undefined;
  return pub.videoTrack as RemoteVideoTrack;
}

function statusOf(s: ConnectionState): CallStatus {
  switch (s) {
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    case ConnectionState.Connecting:
      return "connecting";
    default:
      return "reconnecting";
  }
}
