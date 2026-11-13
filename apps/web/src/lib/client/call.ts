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
  /** Noise removal on the mic copy: whether it is on, and what the copy had before. */
  noise?: { on: boolean; before: boolean | undefined };
  /** This browser can't give the mic copy its own noise removal: the live part is skipped. */
  noiseUnavailable?: boolean;
  /** Filter changes, one after the other. */
  chain?: Promise<void>;
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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let current: Room | null = null;

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
        const r = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true });
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
        r.on(RoomEvent.Disconnected, () => {
          if (cancelled || r !== current) return;
          snapshot(r);
          // LiveKit gave up reconnecting by itself: start over with a fresh token.
          retryLater(attempt + 1);
        });

        // ?relay=1: use only TURN-relayed connections. For checking that guests behind strict
        // firewalls can still join (and for tests); normal visits never set it.
        const relayOnly = new URLSearchParams(window.location.search).get("relay") === "1";
        await r.connect(t.url, t.token, relayOnly ? { rtcConfig: { iceTransportPolicy: "relay" } } : undefined);
        if (cancelled) return void r.disconnect();
        releasePicture(tracks); // a rejoin starts from fresh clones
        await publish(r, stream, tracks, wanted.current);
        // Whatever changed while this was publishing (nothing to do when there are no filters).
        await syncFilters(tracks, stream, () => wanted.current);
        // Sharing a screen when the call (re)connected: the others get it again.
        await publishScreen(r, tracks, sharing.current).catch((err) => console.warn("[call] screen", err));
        if (cancelled) return releasePicture(tracks);
        snapshot(r);
      } catch (err) {
        releasePicture(tracks);
        if (cancelled) return;
        console.error("[call]", err);
        setState((s) => ({ ...s, status: "failed" }));
        retryLater(attempt + 1);
      }
    };
    void connect(0);

    return () => {
      cancelled = true;
      clearTimeout(retry);
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
      const video = local.current.video;
      if (video) await (off ? video.mute() : video.unmute());
      // With picture filters the call sends the canvas, not the camera copy: keep the copy in step.
      if (local.current.picture && local.current.cam) local.current.cam.enabled = !off;
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

async function publish(r: Room, stream: MediaStream, local: LocalTracks, filters: TrackFilters) {
  const mic = stream.getAudioTracks()[0];
  const cam = stream.getVideoTracks()[0];
  if (mic) {
    const clone = mic.clone();
    clone.enabled = mic.enabled;
    local.mic = clone;
    local.noise = undefined;
    local.audio = new LocalAudioTrack(clone, undefined, true);
    await r.localParticipant.publishTrack(local.audio, { source: Track.Source.Microphone, dtx: true, red: true });
  }
  if (cam) {
    const clone = cam.clone();
    clone.enabled = cam.enabled;
    // Scales only the clone; the original keeps recording at full resolution.
    await clone
      .applyConstraints({ width: { ideal: CALL_VIDEO.width }, height: { ideal: CALL_VIDEO.height }, frameRate: { max: CALL_VIDEO.frameRate } })
      .catch(() => {});
    local.cam = clone;
    // With picture filters, the others never see the plain picture, not even for a moment.
    if (hasVideoFilters(filters) && canPreviewFilters()) local.picture = filteredCopy(clone, filters);
    local.video = new LocalVideoTrack(local.picture?.track ?? clone, undefined, true);
    await r.localParticipant.publishTrack(local.video, {
      source: Track.Source.Camera,
      simulcast: false,
      videoEncoding: { maxBitrate: 600_000, maxFramerate: CALL_VIDEO.frameRate },
    });
    // Firefox ignores those constraints on a cloned camera track and keeps its full size. Then
    // the encoder scales the call's copy down instead (the camera itself is left alone).
    // (The filtered picture is drawn at the call's size already.)
    const height = local.picture ? 0 : (clone.getSettings().height ?? 0);
    if (height > CALL_VIDEO.height * 1.1) await scaleDown(local.video, height / CALL_VIDEO.height);
  }
}

// ── Filters on the call's copies ─────────────────────────────────────────────

const filteredCopy = (clone: MediaStreamTrack, filters: TrackFilters) =>
  // Background blur uses the mask the room keeps running (person-mask.ts); until there is one, the whole picture is blurred.
  startFilteredTrack(clone, { maxHeight: CALL_VIDEO.height, frameRate: CALL_VIDEO.frameRate, filters, mask: getPersonMask });

/** Stops the canvas picture, and the camera copy behind it (LiveKit only stops the track it holds). */
function releasePicture(local: LocalTracks) {
  if (!local.picture) return;
  local.picture.stop();
  local.picture = undefined;
  local.cam?.stop();
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
