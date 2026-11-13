import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { InviteForm } from "@/components/invite-form";
import { Notice } from "@/components/ui";
import { getServices } from "@/server/context";
import { currentUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
// The address holds the invitation's secret: keep it out of search engines and the Referer header.
export const metadata = { title: "You're invited", robots: { index: false }, referrer: "no-referrer" as const };

const link = "font-medium text-text underline underline-offset-[3px] hover:text-accent-strong";

/** Where an invitation into someone's account leads. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const services = await getServices();
  const [invite, user] = await Promise.all([services.members.invitation(token), currentUser()]);

  if (!invite) {
    return (
      <AuthShell title="This invitation isn't open" subtitle="It has been used, withdrawn or has run out.">
        <Notice tone="warn">Ask whoever invited you for a new link.</Notice>
        <p className="text-center text-sm text-muted">
          <Link className={link} href="/login">
            Log in
          </Link>
        </p>
      </AuthShell>
    );
  }
  const subtitle = `${invite.inviter} invited ${invite.email} to their Tapry account: you'll see their studios and recordings and can host sessions.`;
  // Signed in as someone else, or the address already has a log-in that isn't signed in here.
  if (user && user.email !== invite.email) {
    return (
      <AuthShell title="You're invited" subtitle={subtitle}>
        <Notice tone="warn">You&apos;re logged in as {user.email}. Log out, then open this link again.</Notice>
      </AuthShell>
    );
  }
  if (!user && invite.hasAccount) {
    return (
      <AuthShell title="You're invited" subtitle={subtitle}>
        <Notice>This address already has a Tapry log-in. Log in with it, then open this link again to join.</Notice>
        <Link href="/login" className="inline-flex h-[38px] w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-ink-text transition-colors hover:bg-ink-hover">
          Log in
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="You're invited" subtitle={subtitle}>
      <InviteForm token={token} email={invite.email} signedIn={!!user} />
    </AuthShell>
  );
}
