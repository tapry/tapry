"use client";

import type { RemoteAudioTrack, RemoteVideoTrack } from "livekit-client";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui";
import type { RemotePeer } from "@/lib/client/call";

/** You plus everyone in the call, in a grid that fits up to 8 people. */
export function CallGrid({
  stream,
  selfName,
  selfMicMuted,
  selfCameraOff,
  selfSpeaking,
  peers,
  recording,
}: {
  stream: MediaStream;
  selfName: string;
  selfMicMuted: boolean;
  selfCameraOff: boolean;
  selfSpeaking: boolean;
  peers: RemotePeer[];
  recording: boolean;
}) {
  const count = peers.length + 1;
  const cols = count === 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className={cn("grid gap-3", cols)}>
      <Tile
        name={`${selfName} (you)`}
        micMuted={selfMicMuted}
        speaking={selfSpeaking && !selfMicMuted}
        recording={recording}
        testId="self-tile"
      >
        {stream.getVideoTracks().length > 0 && !selfCameraOff ? (
          <StreamVideo stream={stream} />
        ) : (
          <Avatar name={selfName} />
        )}
      </Tile>
      {peers.map((p) => (
        <Tile key={p.id} name={p.name} micMuted={p.micMuted} speaking={p.speaking} recording={recording} testId="remote-tile">
          {p.video && !p.cameraOff ? <TrackVideo track={p.video} /> : <Avatar name={p.name} />}
          {p.audio && <TrackAudio track={p.audio} />}
        </Tile>
      ))}
    </div>
  );
}

function Tile({
  name,
  micMuted,
  speaking,
  recording,
  testId,
  children,
}: {
  name: string;
  micMuted: boolean;
  speaking: boolean;
  recording: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      data-name={name}
      data-mic={micMuted ? "muted" : "on"}
      className={cn(
        "relative aspect-video overflow-hidden rounded-xl border-2 bg-surface-2 transition-colors",
        speaking ? "border-ok" : recording ? "border-accent" : "border-border",
      )}
    >
      {children}
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
        {micMuted && <MicOffIcon />}
        {name}
      </span>
    </div>
  );
}

function StreamVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  // Your own view is mirrored, like a mirror; others see you unmirrored.
  return <video ref={ref} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />;
}

function TrackVideo({ track }: { track: RemoteVideoTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className="size-full object-cover" />;
}

function TrackAudio({ track }: { track: RemoteAudioTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="grid size-full place-items-center">
      <span className="grid size-16 place-items-center rounded-full bg-border text-xl font-medium">{initials || "?"}</span>
    </div>
  );
}

function MicOffIcon() {
  return (
    <svg aria-label="Muted" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.8" />
      <path d="M19 10v2a7 7 0 0 1-.9 3.4M5 10v2a7 7 0 0 0 11.6 5.3M12 19v3M2 2l20 20" />
    </svg>
  );
}
