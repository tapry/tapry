import { LocaleProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";
import { getServices } from "@/server/context";
import { parseGuide } from "@/lib/guide";
import { GuestHeading, GuestShell } from "../../join/shell";
import { SoloForm } from "./solo-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record your answer", robots: { index: false } };

/**
 * A studio's solo link: one person records alone, in their own time. They see who asks and
 * what, agree to be recorded, and go on to the same device check and recorder as any guest,
 * where they start and stop the recording themselves.
 */
export default async function SoloPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = await getServices();
  const { locale, t } = await getT();
  const [preview, brand] = await Promise.all([services.studios.soloPreview(code, locale), services.brand.forSolo(code)]);
  if (!preview) {
    return (
      <GuestShell title="Tapry" locale={locale}>
        <div className="flex max-w-[520px] flex-col gap-4 p-[clamp(20px,4vw,36px)]">
          <GuestHeading title={t("solo.deadTitle")}>{t("solo.deadBody")}</GuestHeading>
        </div>
      </GuestShell>
    );
  }
  const questions = parseGuide(preview.prompt);
  return (
    <GuestShell title={preview.studioName} brand={brand} locale={locale}>
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 p-[clamp(20px,4vw,36px)]">
        <GuestHeading title={t("solo.title", { host: preview.hostName })}>
          {t(preview.settings.audioOnly ? "solo.bodyAudio" : "solo.body", { minutes: preview.maxMinutes, host: preview.hostName })}
        </GuestHeading>
        {questions.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-testid="solo-prompt">
            <span className="text-[14px] text-muted">{t("solo.prompt", { host: preview.hostName })}</span>
            {questions.map((q, i) =>
              q.kind === "section" ? (
                <span key={i} className="pt-1 text-[13.5px] font-medium tracking-wide text-muted uppercase">
                  {q.text}
                </span>
              ) : (
                <span key={i} className="text-[15.5px] leading-snug text-pretty">
                  {q.text}
                </span>
              ),
            )}
          </div>
        )}
        <LocaleProvider locale={locale}>
          <SoloForm code={code} hostName={preview.hostName} consentText={preview.consentText} consentHash={preview.consentHash} />
        </LocaleProvider>
      </div>
    </GuestShell>
  );
}
