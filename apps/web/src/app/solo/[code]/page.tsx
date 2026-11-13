import { getServices } from "@/server/context";
import { parseGuide } from "@/lib/guide";
import { GuestHeading, GuestShell } from "../../join/shell";
import { SoloForm } from "./solo-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record your answer", robots: { index: false } };

/**
 * A studio's solo link: one person records alone, in their own time. They see who asks and
 * what, agree to be recorded, and go on to the same device check and recorder as any guest,
 * where they start and stop the recording themselves.
 */
export default async function SoloPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const preview = await (await getServices()).studios.soloPreview(code);
  if (!preview) {
    return (
      <GuestShell title="Tapry">
        <div className="flex max-w-[520px] flex-col gap-4 p-[clamp(20px,4vw,36px)]">
          <GuestHeading title="This link doesn't work">It may have been switched off, or the studio was deleted. Ask whoever sent it for the current link.</GuestHeading>
        </div>
      </GuestShell>
    );
  }
  const questions = parseGuide(preview.prompt);
  return (
    <GuestShell title={preview.studioName}>
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 p-[clamp(20px,4vw,36px)]">
        <GuestHeading title={`Record for ${preview.hostName}`}>
          You record on your own, when it suits you: {preview.settings.audioOnly ? "your microphone" : "your camera and microphone"}, in this browser. You start and stop it yourself, up to{" "}
          {preview.maxMinutes} minutes, and it is sent to {preview.hostName} when you&apos;re done.
        </GuestHeading>
        {questions.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-testid="solo-prompt">
            <span className="text-[13px] text-muted">What {preview.hostName} would like to hear about</span>
            {questions.map((q, i) =>
              q.kind === "section" ? (
                <span key={i} className="pt-1 text-[12.5px] font-medium tracking-wide text-muted uppercase">
                  {q.text}
                </span>
              ) : (
                <span key={i} className="text-[14.5px] leading-snug text-pretty">
                  {q.text}
                </span>
              ),
            )}
          </div>
        )}
        <SoloForm code={code} hostName={preview.hostName} consentText={preview.consentText} consentHash={preview.consentHash} />
      </div>
    </GuestShell>
  );
}
