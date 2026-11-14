import Link from "next/link";
import { Logo } from "@/components/ui";
import { UploadSpeed } from "./upload-speed";

export const metadata = {
  title: "Upload-speed check",
  description: "Is your internet good enough to record a podcast, interview or video? Test your upload speed, free.",
};

/** The free upload-speed check, also on self-hosted servers: no account, tests against this server. */
export default function UploadSpeedPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <section className="bg-blush px-[clamp(16px,3vw,28px)] pt-8 pb-10">
        <div className="mx-auto flex max-w-[760px] flex-col gap-[clamp(32px,6vw,64px)]">
          <Link href="/" aria-label="Tapry home" className="self-start text-text hover:text-text">
            <Logo className="text-[16px]" mark="size-6" />
          </Link>
          <div className="flex flex-col gap-4">
            <h1 className="animate-rise text-[clamp(32px,4vw,48px)] leading-[1.06] font-medium tracking-[-.03em] text-balance">
              Is your internet good enough to record?
            </h1>
            <p className="max-w-[560px] text-[18px] leading-normal text-pretty text-muted">
              Recording depends on upload, not download. This measures how fast your recording can travel from your computer to this
              server. Takes about five seconds; the test data is thrown away.
            </p>
          </div>
        </div>
      </section>
      <main className="mx-auto w-full max-w-[760px] px-[clamp(16px,3vw,28px)] pt-2 pb-20">
        <UploadSpeed endpoint="/api/speed-test" />
      </main>
    </div>
  );
}
