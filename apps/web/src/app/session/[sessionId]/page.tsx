import { SessionClient } from "./session-client";

export const metadata = { title: "Studio" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <main className="min-h-dvh bg-canvas">
      <SessionClient sessionId={sessionId} />
    </main>
  );
}
