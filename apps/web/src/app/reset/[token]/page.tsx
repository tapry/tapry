import { ResetForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";
// The address holds the link's secret: keep it out of search engines and out of the Referer header.
export const metadata = { title: "Set a new password", robots: { index: false }, referrer: "no-referrer" as const };

/** Where the "new password" email leads. The link is checked when the form is sent. */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthShell title="Set a new password" subtitle="Choose a new password for your account. Every device will be signed out.">
      <ResetForm token={token} />
    </AuthShell>
  );
}
