import { SessionClient } from "./session-client";

export const metadata = { title: "Studio" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <SessionClient sessionId={sessionId} />
    </main>
  );
}
