import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Logo, StatusDot } from "./ui";

/** Split screen for log in / sign up / first visit: the form on the left, a calm studio picture on the right. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-2">
      <div className="mx-auto flex w-full max-w-[560px] flex-col justify-center gap-7 px-6 py-12 sm:px-12 lg:px-20">
        <Link href="/" className="text-text">
          <Logo />
        </Link>
        <div className="flex flex-col gap-2.5">
          <h1 className="text-[clamp(32px,3.6vw,44px)] leading-[1.05] font-bold tracking-[-.03em]">{title}</h1>
          <p className="text-[17px] leading-normal text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
      <StudioPicture />
    </div>
  );
}

/** Decorative: a studio with three people and a ready recording. Nothing here is real data. */
function StudioPicture() {
  return (
    <div
      aria-hidden
      className="relative hidden items-center justify-center overflow-hidden p-10 lg:flex"
      style={{ background: "linear-gradient(140deg,#ffe3d6 0%,#f4b6a3 40%,#d98a9c 75%,#9d86c4 100%)" }}
    >
      <div className="absolute -bottom-[30%] -left-[15%] size-[80%] rounded-full bg-white/20" />
      <div className="relative flex w-full max-w-[460px] flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-2 rounded-[18px] bg-white p-3 shadow-[0_30px_60px_-30px_rgba(60,20,30,.6)]">
          {[
            { name: "Yasmine", wide: true, speaking: true },
            { name: "Tom", wide: false, speaking: false },
            { name: "Ines", wide: false, speaking: false },
          ].map((p) => (
            <div
              key={p.name}
              className={`relative grid place-items-center rounded-xl bg-[#f2f1ef] ${p.wide ? "col-span-2 aspect-[16/8]" : "aspect-[4/3]"}`}
              style={p.speaking ? { outline: "3px solid #1f9d55", outlineOffset: -3 } : undefined}
            >
              <Avatar name={p.name} className={p.wide ? "size-20 text-2xl" : "size-14 text-lg"} />
              <span className="absolute bottom-2 left-2 rounded-lg bg-[rgba(30,26,26,.72)] px-2.5 py-1 text-xs text-white">
                {p.name}
              </span>
            </div>
          ))}
        </div>
        <span className="flex items-center gap-2 self-start rounded-full bg-white px-3.5 py-2 text-sm font-medium text-[#1d1d1f] shadow-[0_8px_20px_-10px_rgba(60,20,30,.5)]">
          <StatusDot tone="ok" /> Recording 40 · ready to download
        </span>
      </div>
    </div>
  );
}
