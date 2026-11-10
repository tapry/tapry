import Link from "next/link";
import { getServices } from "@/server/context";
import { GuestHeading, GuestShell } from "../../shell";
import { TechCheck } from "./tech-check";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test your setup" };

/** The guest tech check, sent by the host before the session: same invite code, no account. */
export default async function TechCheckPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const preview = await (await getServices()).studios.invitePreview(inviteCode);
  if (!preview) {
    return (
      <GuestShell title="Tapry">
        <div className="flex max-w-[520px] flex-col gap-4 p-[clamp(20px,4vw,36px)]">
          <GuestHeading title="This link doesn't work">It may have been replaced with a new one. Ask your host for the current link.</GuestHeading>
        </div>
      </GuestShell>
    );
  }
  return (
    <GuestShell
      title={preview.studioName}
      right={<span className="rounded-md bg-surface-2 px-[9px] py-1 text-[13px] font-medium whitespace-nowrap">Tech check</span>}
    >
      <div className="flex animate-fade-up flex-col gap-[22px] p-[clamp(20px,4vw,36px)]">
        <GuestHeading title={`Test your setup for ${preview.studioName}`}>
          {preview.hostName} asked you to check your browser, {preview.settings.audioOnly ? "microphone" : "camera, microphone"} and
          connection before the session. Nothing here is recorded for the studio.
        </GuestHeading>
        <TechCheck inviteCode={inviteCode} hostName={preview.hostName} settings={preview.settings} />
        <p className="text-[13.5px] text-muted">
          Ready now?{" "}
          <Link href={`/join/${inviteCode}`} className="font-medium text-text underline underline-offset-2 hover:text-accent-strong">
            Go to the invite
          </Link>{" "}
          (you can join once {preview.hostName} has opened the studio).
        </p>
      </div>
    </GuestShell>
  );
}
