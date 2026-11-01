import { redirect } from "next/navigation";

// Studios are called shows in the app now; keep old links working.
export default async function StudioRedirect({ params }: { params: Promise<{ studioId: string }> }) {
  redirect(`/shows/${(await params).studioId}`);
}
