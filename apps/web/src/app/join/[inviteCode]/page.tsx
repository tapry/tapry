import Link from "next/link";
import { Avatar } from "@/components/ui";
import { getServices } from "@/server/context";
import { Icon, ICON } from "../../session/[sessionId]/icons";
import { GuestGrid, GuestHeading, GuestShell, Steps } from "../shell";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join recording" };

export default async function JoinPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const preview = await (await getServices()).studios.invitePreview(inviteCode);
  if (!preview) {
    return (
      <GuestShell title="Tapry">
        <div className="flex max-w-[520px] flex-col gap-4 p-[clamp(20px,4vw,36px)]">
          <GuestHeading title="This invite link doesn't work">
            It may have been replaced with a new one, or the studio was deleted. Ask your host to send you the current link.
          </GuestHeading>
        </div>
      </GuestShell>
    );
  }
  const audioOnly = preview.settings.audioOnly;
  return (
    <GuestShell title={preview.studioName} right={<Steps current={0} />}>
      <GuestGrid>
        {/* The call stage is dark in both themes. No camera is opened here: that waits for the next step. */}
        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[14px] bg-[#18181b] text-white [--ring:#fafafa]">
          <span className="flex flex-col items-center gap-3 px-6 text-center">
            <Avatar name={preview.hostName} className="size-20 text-2xl ring-4 ring-white/10" />
            <span className="text-[15px] font-medium">{preview.hostName}</span>
          </span>
          <span className="absolute bottom-3 left-3 flex items-center gap-2.5 rounded-full bg-black/60 py-1.5 pr-3 pl-2 backdrop-blur-md">
            <span className="grid size-[22px] place-items-center rounded-full bg-accent text-accent-text">
              <Icon d={audioOnly ? ICON.mic : ICON.cam} className="size-[11px]" strokeWidth={2.6} />
            </span>
            <span className="text-[12.5px]">{audioOnly ? "Sound only" : "Camera and microphone"}</span>
          </span>
        </div>

        <div className="flex animate-fade-up flex-col gap-4">
          <GuestHeading title={`${preview.hostName} invited you to record`}>
            No account, nothing to install. You&apos;ll be recorded on this computer
            {audioOnly ? ", sound only (no camera)" : " in full quality"}.
          </GuestHeading>
          <JoinForm inviteCode={inviteCode} hostName={preview.hostName} consentText={preview.consentText} consentHash={preview.consentHash} />
          <p className="text-[13.5px] text-muted">
            Early?{" "}
            <Link href={`/join/${inviteCode}/check`} className="font-medium text-text underline underline-offset-2 hover:text-accent-strong">
              Test your setup first
            </Link>
            .
          </p>
        </div>
      </GuestGrid>
    </GuestShell>
  );
}
