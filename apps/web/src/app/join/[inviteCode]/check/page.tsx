import Link from "next/link";
import { Logo } from "@/components/ui";
import { getServices } from "@/server/context";
import { TechCheck } from "./tech-check";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test your setup" };

/** The guest tech check, sent by the host before the session: same invite code, no account. */
export default async function TechCheckPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const preview = await (await getServices()).studios.invitePreview(inviteCode);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1120px] flex-col gap-6 px-[clamp(16px,3vw,32px)] py-8">
      <Logo className="text-[15px]" />
      {preview ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[clamp(26px,3vw,34px)] leading-[1.1] font-bold tracking-[-.02em]">Test your setup for {preview.studioName}</h1>
            <p className="max-w-[640px] text-[15px] text-text-2">
              {preview.hostName} asked you to check your browser, {preview.settings.audioOnly ? "microphone" : "camera, microphone"} and
              connection before the session. Nothing here is recorded for the studio.
            </p>
          </div>
          <TechCheck inviteCode={inviteCode} hostName={preview.hostName} settings={preview.settings} />
          <p className="text-sm text-muted">
            Ready now? <Link href={`/join/${inviteCode}`} className="underline">Go to the invite</Link> (you can join once{" "}
            {preview.hostName} has opened the studio).
          </p>
        </>
      ) : (
        <div className="flex max-w-[480px] flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-[-.02em]">This link doesn&apos;t work</h1>
          <p className="text-[15px] text-text-2">It may have been replaced with a new one. Ask your host for the current link.</p>
        </div>
      )}
    </main>
  );
}
