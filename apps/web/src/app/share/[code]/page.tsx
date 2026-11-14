import { LogoMark } from "@/components/ui";
import { SharedPlayer, SharedTranscript } from "@/components/shared-player";
import { shortClock } from "@/lib/format";
import { getServices } from "@/server/context";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const shared = await (await getServices()).share.view((await params).code);
  // Reachable by its link only: never for search engines, and nothing about it in the address.
  return { title: shared ? shared.title : "Recording", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
}

/** A recording's public page: its player, and its transcript when the host shares that too. */
export default async function SharePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = await getServices();
  const [shared, brand] = await Promise.all([services.share.view(code), services.brand.forShare(code)]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[860px] flex-col gap-6 px-5 py-10">
      {shared ? (
        <>
          <header className="flex flex-col gap-1">
            {brand?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" data-testid="brand-logo" className="mb-3 h-8 w-auto max-w-[160px] self-start rounded-[4px] object-contain" />
            )}
            <h1 className="text-[27px] leading-tight font-medium tracking-[-.02em] text-balance">{shared.title}</h1>
            <span className="text-[14.5px] text-muted">{shortClock(shared.lengthMs)}</span>
          </header>
          <SharedPlayer code={code} shared={shared} />
          {shared.turns && shared.turns.length > 0 && (
            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-medium">Transcript</h2>
              <SharedTranscript turns={shared.turns} />
            </section>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2 py-16" data-testid="share-gone">
          <h1 className="text-[23px] font-medium">This recording isn&apos;t shared</h1>
          <p className="text-muted">The link may have been switched off or replaced, or the recording deleted. Ask whoever sent it for the current link.</p>
        </div>
      )}
      {services.guestPromoUrl && (
        <footer className="mt-auto flex items-center gap-2 pt-6 text-[14px] text-muted">
          <LogoMark small />
          <a href={services.guestPromoUrl} className="underline underline-offset-[3px]">
            Recorded with Tapry
          </a>
        </footer>
      )}
    </main>
  );
}
