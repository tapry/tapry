import Link from "next/link";
import { LocaleProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";
import { getServices } from "@/server/context";
import { GuestHeading, GuestShell } from "../../shell";
import { TechCheck } from "./tech-check";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test your setup" };

/** The guest tech check, sent by the host before the session: same invite code, no account. */
export default async function TechCheckPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const services = await getServices();
  const { locale, t } = await getT();
  const [preview, brand] = await Promise.all([services.studios.invitePreview(inviteCode, locale), services.brand.forInvite(inviteCode)]);
  if (!preview) {
    return (
      <GuestShell title="Tapry" locale={locale}>
        <div className="flex max-w-[520px] flex-col gap-4 p-[clamp(20px,4vw,36px)]">
          <GuestHeading title={t("solo.deadTitle")}>{t("check.deadBody")}</GuestHeading>
        </div>
      </GuestShell>
    );
  }
  return (
    <GuestShell
      brand={brand}
      locale={locale}
      title={preview.studioName}
      right={<span className="rounded-md bg-surface-2 px-[9px] py-1 text-[13px] font-medium whitespace-nowrap">{t("check.badge")}</span>}
    >
      <div className="flex animate-fade-up flex-col gap-[22px] p-[clamp(20px,4vw,36px)]">
        <GuestHeading title={t("check.title", { studio: preview.studioName })}>
          {t(preview.settings.audioOnly ? "check.bodyAudio" : "check.body", { host: preview.hostName })}
        </GuestHeading>
        <LocaleProvider locale={locale}>
          <TechCheck inviteCode={inviteCode} hostName={preview.hostName} settings={preview.settings} />
        </LocaleProvider>
        <p className="text-[13.5px] text-muted">
          {t("check.readyNow")}{" "}
          <Link href={`/join/${inviteCode}`} className="font-medium text-text underline underline-offset-2 hover:text-accent-strong">
            {t("check.goInvite")}
          </Link>{" "}
          {t("check.joinOnce", { host: preview.hostName })}
        </p>
      </div>
    </GuestShell>
  );
}
