// What a share page and the embedded player both show: the recording's combined video or mix,
// played by the browser's own player, straight from storage through a signed link.
import { shortClock } from "@/lib/format";
import type { SharedRecording } from "@/server/share";

export function SharedPlayer({ code, shared }: { code: string; shared: SharedRecording }) {
  const src = `/api/share/${code}/media`;
  return shared.media === "video" ? (
    <video src={src} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black" data-testid="shared-media" />
  ) : (
    <audio src={src} controls preload="metadata" className="w-full" data-testid="shared-media" />
  );
}

export function SharedTranscript({ turns }: { turns: NonNullable<SharedRecording["turns"]> }) {
  return (
    <div className="flex flex-col" data-testid="shared-transcript">
      {turns.map((t, i) => (
        <p key={`${t.startMs}-${i}`} className="border-t border-divider py-2.5 text-[14.5px] leading-relaxed text-pretty">
          <span className="font-medium">{t.speaker || "Someone"}</span> <span className="text-[12.5px] text-muted tabular-nums">{shortClock(t.startMs)}</span>
          <br />
          <span className="text-text-2">{t.text}</span>
        </p>
      ))}
    </div>
  );
}
