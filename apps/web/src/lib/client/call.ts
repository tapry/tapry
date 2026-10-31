"use client";

import type { CallToken, SessionTicket } from "@opentake/shared";
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

export type CallStatus = "off" | "connecting" | "connected" | "reconnecting" | "failed";

export interface RemotePeer {
  /** Participant id (the LiveKit identity). */
  id: string;
  name: string;
  video?: RemoteVideoTrack;
  audio?: RemoteAudioTrack;
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

/**
 * The live call. It runs beside the recording and never touches it: what goes to
 * LiveKit are clones of the camera and mic tracks, scaled down for the call, so a
 * bad connection only degrades the call while the local recording stays full quality.
 */
export function useCall(ticket: SessionTicket, stream: MediaStream, enabled: boolean) {
  const [state, setState] = useState<CallState>({ status: "off", peers: [], localSpeaking: false, audioBlocked: false });
  const room = useRef<Room | null>(null);
  const local = useRef<{ audio?: LocalAudioTrack; video?: LocalVideoTrack }>({});

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
        await publish(r, stream, local.current);
        snapshot(r);
      } catch (err) {
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
      room.current = null;
      local.current = {};
    };
  }, [ticket, stream, enabled]);

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
    },
    [stream],
  );

  return { ...state, startAudio, setMicMuted, setCameraOff };
}

async function publish(r: Room, stream: MediaStream, local: { audio?: LocalAudioTrack; video?: LocalVideoTrack }) {
  const mic = stream.getAudioTracks()[0];
  const cam = stream.getVideoTracks()[0];
  if (mic) {
    const clone = mic.clone();
    clone.enabled = mic.enabled;
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
    local.video = new LocalVideoTrack(clone, undefined, true);
    await r.localParticipant.publishTrack(local.video, {
      source: Track.Source.Camera,
      simulcast: false,
      videoEncoding: { maxBitrate: 600_000, maxFramerate: CALL_VIDEO.frameRate },
    });
    // Firefox ignores those constraints on a cloned camera track and keeps its full size. Then
    // the encoder scales the call's copy down instead (the camera itself is left alone).
    const height = clone.getSettings().height ?? 0;
    if (height > CALL_VIDEO.height * 1.1) await scaleDown(local.video, height / CALL_VIDEO.height);
  }
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
    micMuted: !mic || mic.isMuted,
    cameraOff: !cam || cam.isMuted,
    speaking: p.isSpeaking,
  };
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
