"use client";

import type { TrackFilters } from "@tapry/shared";
import type { RemoteAudioTrack, RemoteVideoTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Avatar as Initials, cn } from "@/components/ui";
import type { RemotePeer } from "@/lib/client/call";
import { Icon, ICON } from "./icons";
import { SelfVideo } from "./self-video";

export type Layout = "grid" | "speaker" | "side";

/**
 * The call stage is dark in both themes (the designs' #18181b stage, #1c1c1f tiles, and a light
 * terracotta ring for whoever is speaking): it frames video, so it doesn't follow the page theme.
 */
const TILE_BG = "bg-[#1c1c1f]";
const SPEAKING_RING = "outline-[#ff8f78]";

/**
 * You plus everyone in the call. Grid, speaker (whoever of the others spoke last, full width) or
 * side by side: the layout only changes how the tiles are placed, never what's sent or recorded.
 * "full" fills the full-screen view's height instead of keeping the tiles' aspect ratio. The room
 * keeps one CallGrid mounted and only switches the variant, so going full screen never re-attaches
 * anyone's video or sound.
 */
export function CallGrid({
  stream,
  selfId,
  selfName,
  selfMicMuted,
  selfCameraOff,
  selfSpeaking,
  selfFilters,
  selfMirror,
  peers,
  recording,
  layout = "grid",
  variant = "stage",
  badges,
  screen,
}: {
  stream: MediaStream;
  selfId: string;
  selfName: string;
  selfMicMuted: boolean;
  selfCameraOff: boolean;
  selfSpeaking: boolean;
  /** Your own tile shows your picture filters, as the others get them, and your mirror choice. */
  selfFilters?: TrackFilters;
  selfMirror?: boolean;
  peers: RemotePeer[];
  recording: boolean;
  layout?: Layout;
  variant?: "stage" | "full";
  /** Small warning on someone's tile (the host's view of an upload falling behind), by participant id. */
  badges?: Map<string, string>;
  /**
   * A screen being shared: the big tile above everyone. `track` is another person's; your own
   * isn't shown back to you (a screen showing itself is a hall of mirrors), only that it's shared.
   */
  screen?: { label: string; track?: RemoteVideoTrack } | null;
}) {
  const count = peers.length + 1;
  // A shared screen takes the big tile; the speaker layout is back when it ends.
  const spot = useSpotlight(peers, layout === "speaker");
  const speaker = screen ? null : spot;

  const full = variant === "full";
  const cols =
    count === 1
      ? "grid-cols-1"
      : layout === "side" && !screen
        ? count === 2
          ? "grid-cols-2"
          : "grid-cols-2 sm:grid-cols-3"
        : layout === "speaker" || screen
          ? count <= 3
            ? "grid-cols-2"
            : "grid-cols-3"
          : count <= 4
            ? "grid-cols-1 sm:grid-cols-2"
            : "grid-cols-2 lg:grid-cols-3";
  const aspect = (id: string) =>
    full ? "min-h-0" : count === 1 || screen ? "aspect-video" : layout === "side" ? "aspect-[3/4]" : id === speaker ? "aspect-[21/9]" : "aspect-video";
  const tile = (id: string) => ({
    full,
    className: aspect(id),
    spotlight: id === speaker,
    badge: badges?.get(id),
  });

  return (
    <div
      className={cn(
        "grid",
        cols,
        full ? "min-h-0 min-w-0 flex-1 auto-rows-[minmax(0,1fr)] gap-2.5" : "gap-2",
        full && (speaker || screen) && "grid-rows-[minmax(0,2fr)_minmax(0,1fr)]",
        !full && layout === "side" && !screen && count > 1 && "mx-auto w-full max-w-[640px]",
      )}
    >
      {screen && (
        <div
          data-testid="screen-tile"
          data-name={screen.label}
          className={cn("relative order-first col-span-full overflow-hidden bg-black text-white", full ? "min-h-0 rounded-[14px]" : "aspect-video rounded-lg")}
        >
          {screen.track ? (
            <TrackVideo track={screen.track} contain />
          ) : (
            <div className="grid size-full place-items-center px-6 text-center text-sm text-white/75">
              {recording ? "You're sharing your screen. It is being recorded." : "You're sharing your screen. It is recorded while a recording runs."}
            </div>
          )}
          <span className={cn("absolute flex max-w-[calc(100%-20px)] items-center bg-black/60", full ? "bottom-3 left-3 rounded-lg px-[11px] py-1.5 text-sm font-medium backdrop-blur-md" : "bottom-2.5 left-2.5 rounded-[7px] px-[9px] py-1 text-[14px]")}>
            <span className="truncate">{screen.label}</span>
          </span>
        </div>
      )}
      <Tile
        name={`${selfName} (you)`}
        label={selfName}
        micMuted={selfMicMuted}
        speaking={selfSpeaking && !selfMicMuted}
        recording={recording}
        testId="self-tile"
        {...tile(selfId)}
      >
        {stream.getVideoTracks().length > 0 && !selfCameraOff ? (
          // Your own view is mirrored, like a mirror (unless you turned that off); others see you unmirrored.
          <SelfVideo stream={stream} filters={selfFilters} mirror={selfMirror} />
        ) : (
          <Avatar name={selfName} />
        )}
      </Tile>
      {peers.map((p) => (
        <Tile
          key={p.id}
          name={p.name}
          label={p.name}
          micMuted={p.micMuted}
          speaking={p.speaking}
          recording={recording}
          testId="remote-tile"
          {...tile(p.id)}
        >
          {p.video && !p.cameraOff ? <TrackVideo track={p.video} /> : <Avatar name={p.name} />}
          {p.audio && <TrackAudio track={p.audio} />}
        </Tile>
      ))}
    </div>
  );
}

/** Speaker layout: someone has to talk this long after the last switch before the big tile changes. */
const SPEAKER_HOLD_MS = 2_000;

/**
 * Who gets the big tile in the speaker layout: the last of the others to speak (never yourself:
 * you don't need to watch yourself talk), held for a moment so short interjections don't flip it.
 * Remembered while another layout is showing; null when off or alone.
 */
function useSpotlight(peers: RemotePeer[], on: boolean) {
  const [spot, setSpot] = useState<string | null>(null);
  const switchedAt = useRef(0);
  // Whoever has the tile keeps it while they're still talking, even if someone else talks too.
  const candidate = peers.find((p) => p.id === spot)?.speaking ? spot : (peers.find((p) => p.speaking)?.id ?? null);
  useEffect(() => {
    if (!candidate || candidate === spot) return;
    const id = setTimeout(
      () => {
        switchedAt.current = performance.now();
        setSpot(candidate);
      },
      Math.max(0, switchedAt.current + SPEAKER_HOLD_MS - performance.now()),
    );
    return () => clearTimeout(id);
  }, [candidate, spot]);
  if (!on || peers.length === 0) return null;
  return spot && peers.some((p) => p.id === spot) ? spot : peers[0]!.id;
}

function Tile({
  name,
  label,
  micMuted,
  speaking,
  recording,
  testId,
  full,
  spotlight,
  badge,
  className,
  children,
}: {
  name: string;
  label: string;
  micMuted: boolean;
  speaking: boolean;
  recording: boolean;
  testId: string;
  full: boolean;
  spotlight: boolean;
  badge?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      data-name={name}
      data-mic={micMuted ? "muted" : "on"}
      data-recording={recording ? "on" : "off"}
      className={cn(
        "relative overflow-hidden text-white transition-[outline-color] duration-300",
        TILE_BG,
        full ? "rounded-[14px] outline-3 -outline-offset-3" : "rounded-lg outline-2 -outline-offset-2",
        speaking ? SPEAKING_RING : "outline-transparent",
        spotlight && "order-first col-span-full",
        className,
      )}
    >
      {children}
      <span
        className={cn(
          "absolute flex max-w-[calc(100%-20px)] items-center bg-black/60",
          full ? "bottom-3 left-3 gap-2 rounded-lg px-[11px] py-1.5 text-sm font-medium backdrop-blur-md" : "bottom-2.5 left-2.5 gap-[7px] rounded-[7px] px-[9px] py-1 text-[14px]",
        )}
      >
        {micMuted && <MicOffIcon />}
        <span className="truncate">{label}</span>
        {name !== label && <span className="text-white/60">(you)</span>}
      </span>
      {badge && (
        // On the dark stage in both themes, so the white chip keeps its fixed amber text.
        <span
          className={cn(
            "absolute flex max-w-[calc(100%-20px)] items-center gap-[5px] overflow-hidden bg-white/95 whitespace-nowrap text-[#b45309]",
            full ? "top-3 right-3 rounded-lg px-2.5 py-[5px] text-[13.5px] font-medium" : "top-2.5 right-2.5 rounded-[7px] px-2 py-[3px] text-xs",
          )}
        >
          <Icon d={ICON.cloudUp} className="size-[13px]" />
          {badge}
        </span>
      )}
    </div>
  );
}

function TrackVideo({ track, contain = false }: { track: RemoteVideoTrack; /** Show all of it (a screen), not a filled tile (a face). */ contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={cn("size-full", contain ? "object-contain" : "object-cover")} />;
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
  return (
    <div className="grid size-full place-items-center">
      <Initials name={name} className="aspect-square w-[24%] max-w-24 min-w-10 text-[clamp(14px,2vw,26px)]" />
    </div>
  );
}

function MicOffIcon() {
  return (
    <svg aria-label="Muted" viewBox="0 0 24 24" className="size-[13px] shrink-0 text-[#ff8f78]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON.micOff} />
    </svg>
  );
}
