import { VerifyForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";
// The address holds the link's secret: keep it out of search engines and out of the Referer header.
export const metadata = { title: "Confirm your email", robots: { index: false }, referrer: "no-referrer" as const };

/** Where the "confirm your address" email leads. */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthShell title="Confirm your email" subtitle="One click and your account is ready to record.">
      <VerifyForm token={token} />
    </AuthShell>
  );
}
