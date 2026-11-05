import { redirect } from "next/navigation";

// Studios were called shows for a while; keep old links working.
export default async function ShowRedirect({ params }: { params: Promise<{ showId: string }> }) {
  redirect(`/studios/${(await params).showId}`);
}
