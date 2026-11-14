import { getLocale } from "@/lib/i18n/server";
import { getServices } from "@/server/context";
import { SessionClient } from "./session-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  // The studio's logo and colour for the green room. Nothing private: guests see them on the invite page too.
  const [brand, locale] = await Promise.all([(await getServices()).brand.forSession(sessionId), getLocale()]);
  return (
    <main className="min-h-dvh bg-canvas">
      <SessionClient sessionId={sessionId} brand={brand} locale={locale} />
    </main>
  );
}
