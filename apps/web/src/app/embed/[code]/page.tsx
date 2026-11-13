import { SharedPlayer } from "@/components/shared-player";
import { getServices } from "@/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recording", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/**
 * The player alone, for an <iframe> on another site. The one page of the app that may be
 * framed (the proxy sends X-Frame-Options for everything else).
 */
export default async function EmbedPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const shared = await (await getServices()).share.view(code);
  return (
    <main className="flex min-h-dvh w-full flex-col justify-center bg-canvas p-2">
      {shared ? <SharedPlayer code={code} shared={shared} /> : <p className="p-4 text-center text-sm text-muted" data-testid="share-gone">This recording isn&apos;t shared.</p>}
    </main>
  );
}
