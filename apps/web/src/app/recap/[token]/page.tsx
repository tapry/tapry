import { OwnFiles } from "@/components/own-files";
import { Logo } from "@/components/ui";
import { EmberCard, EmberPage, Icon } from "@/components/ui-extra";
import { getServices } from "@/server/context";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your recording",
  // The address itself is the key to this page: keep it out of search engines and other sites' logs.
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

/** Where a guest's recap email leads: their own files, with freshly signed links. No account. */
export default async function RecapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const services = await getServices();
  const participant = await services.recaps.participantFor(token);
  const own = participant && (await services.processing.ownRecordings(participant, await services.billing.promoFor(participant.sessionId, services.guestPromoUrl)));
  const found = participant && own?.downloads && own.recordings.length > 0;

  return (
    <EmberPage>
      <main className="w-full max-w-[560px]">
        <EmberCard className="flex animate-fade-up flex-col gap-[22px] p-[clamp(22px,5vw,36px)]">
          <Logo className="text-[16px]" mark="size-6" />
          {found ? (
            <>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-[27px] leading-tight font-semibold tracking-[-.025em]">Your recording</h1>
                <p className="text-[15.5px] leading-normal text-pretty text-muted">
                  From {participant.studioName}. These are your files only, recorded on your own device.
                </p>
              </div>
              <div className="flex flex-col gap-3" data-testid="own-recording">
                <OwnFiles recordings={own.recordings} waiting="Getting your file ready. Takes a few minutes; reload this page to check." />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
                <Icon name="link" size={22} />
              </span>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-[27px] leading-tight font-semibold tracking-[-.025em]">This link no longer works</h1>
                <p className="text-[15.5px] leading-normal text-pretty text-muted">
                  It may have expired, or the host may have removed the recording. Ask them for a copy.
                </p>
              </div>
            </div>
          )}
          {own?.promoUrl && (
            <a
              href={own.promoUrl}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-between gap-3 border-t border-border pt-[18px] text-[14.5px] font-medium text-text hover:text-accent-strong"
            >
              Record your own, free
              <span aria-hidden>→</span>
            </a>
          )}
        </EmberCard>
      </main>
    </EmberPage>
  );
}
