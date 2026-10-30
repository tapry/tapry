import { Page } from "@/components/ui";
import { JoinForm } from "./join-form";

export const metadata = { title: "Join recording" };

export default async function JoinPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  return (
    <Page narrow>
      <h1 className="text-2xl font-semibold tracking-tight">Join the recording</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        No account or install needed. Next you'll check your camera and microphone.
      </p>
      <JoinForm inviteCode={inviteCode} />
    </Page>
  );
}
