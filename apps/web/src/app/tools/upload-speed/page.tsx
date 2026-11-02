import { Logo } from "@/components/ui";
import { UploadSpeed } from "./upload-speed";

export const metadata = {
  title: "Upload-speed check",
  description: "Is your internet good enough to record a podcast or interview? Test your upload speed, free.",
};

/** The free upload-speed check, also on self-hosted servers: no account, tests against this server. */
export default function UploadSpeedPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col gap-6 px-[clamp(16px,3vw,32px)] py-8">
      <Logo className="text-[15px]" />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[clamp(28px,3.4vw,38px)] leading-[1.08] font-bold tracking-[-.02em]">Is your internet good enough to record?</h1>
        <p className="text-[15px] text-text-2">
          Test your upload: how fast your recording can travel from your computer to this server. Takes about five seconds; the
          test data is thrown away.
        </p>
      </div>
      <UploadSpeed endpoint="/api/speed-test" />
    </main>
  );
}
