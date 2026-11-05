import { OwnFiles } from "@/components/own-files";
import { Logo } from "@/components/ui";
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
  const own = participant && (await services.processing.ownRecordings(participant, services.guestPromoUrl));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col gap-6 px-[clamp(16px,3vw,32px)] py-8">
      <Logo className="text-[15px]" />
      {participant && own?.downloads && own.recordings.length > 0 ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[clamp(28px,3.4vw,38px)] leading-[1.08] font-bold tracking-[-.02em]">Your recording</h1>
            <p className="text-[15px] text-text-2">From {participant.studioName}. These are your files only, recorded on your own device.</p>
          </div>
          <div className="flex flex-col gap-3" data-testid="own-recording">
            <OwnFiles recordings={own.recordings} waiting="Getting your file ready. Takes a few minutes; reload this page to check." />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[clamp(28px,3.4vw,38px)] leading-[1.08] font-bold tracking-[-.02em]">This link no longer works</h1>
          <p className="text-[15px] text-text-2">It may have expired, or the host may have removed the recording. Ask them for a copy.</p>
        </div>
      )}
      {own?.promoUrl && (
        <a href={own.promoUrl} target="_blank" rel="noopener" className="text-[15px] font-semibold text-accent-strong">
          Record your own, free →
        </a>
      )}
    </main>
  );
}
