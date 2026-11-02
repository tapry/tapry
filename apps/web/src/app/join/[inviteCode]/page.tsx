import Link from "next/link";
import { Avatar, Logo } from "@/components/ui";
import { getServices } from "@/server/context";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join recording" };

export default async function JoinPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const preview = await (await getServices()).studios.invitePreview(inviteCode);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-canvas to-accent-soft px-5 py-12">
      <div className="flex w-full max-w-[480px] flex-col gap-[22px] rounded-3xl bg-surface p-6 shadow-[0_30px_60px_-30px_rgba(60,20,30,.35),0_0_0_1px_var(--border)] sm:p-10">
        {preview ? (
          <>
            <div className="flex items-center gap-3.5">
              <Avatar name={preview.hostName} className="size-14 text-lg ring-[3px] ring-accent-line ring-offset-2 ring-offset-surface" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-muted">{preview.hostName} invited you to</span>
                <h1 className="text-2xl font-bold tracking-[-.02em]">{preview.showName}</h1>
              </span>
            </div>
            <p className="text-[15px] leading-relaxed text-text-2">
              You&apos;ll be recorded {preview.settings.audioOnly ? "(sound only, no camera)" : "in full quality"} right here in your browser. There&apos;s nothing to install and no
              account to make.
            </p>
            <JoinForm inviteCode={inviteCode} hostName={preview.hostName} audioOnly={preview.settings.audioOnly} />
            <p className="text-sm text-muted">
              Early?{" "}
              <Link href={`/join/${inviteCode}/check`} className="underline">
                Test your setup first
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-[-.02em]">This invite link doesn&apos;t work</h1>
            <p className="text-[15px] leading-relaxed text-text-2">
              It may have been replaced with a new one, or the show was deleted. Ask your host to send you the current link.
            </p>
          </>
        )}
      </div>
      <Logo className="text-[15px] opacity-70" />
    </main>
  );
}
