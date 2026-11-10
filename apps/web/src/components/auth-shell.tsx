import Link from "next/link";
import type { ReactNode } from "react";
import { AuthPicture } from "./auth-picture";
import { EmberCard, EmberPage } from "./ui-extra";
import { Logo } from "./ui";

/**
 * Log in / sign up / first visit: a two-column card on the terracotta backdrop, the form on the
 * left and, from 860px, the recording picture on the right.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <EmberPage>
      <EmberCard className="grid min-h-[620px] max-w-[980px] overflow-hidden min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,.9fr)]">
        <div className="flex min-w-0 flex-col px-[clamp(22px,5vw,48px)] pt-7 pb-6">
          <Link href="/" className="self-start text-text hover:text-text">
            <Logo />
          </Link>
          <div className="mx-auto my-7 flex w-full max-w-[380px] flex-1 animate-fade-up flex-col justify-center gap-[18px]">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-.025em]">{title}</h1>
              <p className="text-[14.5px] leading-normal text-pretty text-muted">{subtitle}</p>
            </div>
            {children}
          </div>
          <span className="flex flex-wrap justify-between gap-2 text-[12.5px] text-muted">
            <span>© Tapry contributors</span>
            <span>Open source · self-hosted</span>
          </span>
        </div>
        <AuthPicture />
      </EmberCard>
    </EmberPage>
  );
}
