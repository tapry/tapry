import Link from "next/link";
import { Avatar } from "@/components/ui";
import { LocaleProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";
import { getServices } from "@/server/context";
import { Icon, ICON } from "../../session/[sessionId]/icons";
import { GuestGrid, GuestHeading, GuestShell, Steps } from "../shell";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join recording" };

export default async function JoinPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const services = await getServices();
  const { locale, t } = await getT();
  const [preview, brand] = await Promise.all([services.studios.invitePreview(inviteCode, locale), services.brand.forInvite(inviteCode)]);
  if (!preview) {
    return (
      <GuestShell title="Tapry" locale={locale}>
        <div className="flex max-w-[520px] flex-col gap-4 p-[clamp(20px,4vw,36px)]">
          <GuestHeading title={t("invite.deadTitle")}>{t("invite.deadBody")}</GuestHeading>
        </div>
      </GuestShell>
    );
  }
  const audioOnly = preview.settings.audioOnly;
  return (
    <GuestShell title={preview.studioName} right={<Steps current={0} locale={locale} />} brand={brand} locale={locale}>
      <GuestGrid>
        {/* The call stage is dark in both themes. No camera is opened here: that waits for the next step. */}
        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[14px] bg-[#18181b] text-white [--ring:#fafafa]">
          <span className="flex flex-col items-center gap-3 px-6 text-center">
            <Avatar name={preview.hostName} className="size-20 text-2xl ring-4 ring-white/10" />
            <span className="text-[15px] font-medium">{preview.hostName}</span>
          </span>
          <span className="absolute start-3 bottom-3 flex items-center gap-2.5 rounded-full bg-black/60 py-1.5 ps-2 pe-3 backdrop-blur-md">
            <span className="grid size-[22px] place-items-center rounded-full bg-accent text-accent-text">
              <Icon d={audioOnly ? ICON.mic : ICON.cam} className="size-[11px]" strokeWidth={2.6} />
            </span>
            <span className="text-[12.5px]">{t(audioOnly ? "invite.soundOnly" : "invite.camMic")}</span>
          </span>
        </div>

        <div className="flex animate-fade-up flex-col gap-4">
          <GuestHeading title={t("invite.title", { host: preview.hostName })}>{t(audioOnly ? "invite.bodyAudio" : "invite.body")}</GuestHeading>
          <LocaleProvider locale={locale}>
            <JoinForm inviteCode={inviteCode} hostName={preview.hostName} consentText={preview.consentText} consentHash={preview.consentHash} />
          </LocaleProvider>
          <p className="text-[13.5px] text-muted">
            {t("invite.early")}{" "}
            <Link href={`/join/${inviteCode}/check`} className="font-medium text-text underline underline-offset-2 hover:text-accent-strong">
              {t("invite.testFirst")}
            </Link>
            .
          </p>
        </div>
      </GuestGrid>
    </GuestShell>
  );
}
