import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { PaddlePay } from "@/components/paddle-pay";
import { getServices } from "@/server/context";

export const dynamic = "force-dynamic";
// The address can carry a transaction id: keep it out of search engines and the Referer header.
export const metadata = { title: "Payment", robots: { index: false }, referrer: "no-referrer" as const };

const link = "font-medium text-text underline underline-offset-[3px] hover:text-accent-strong";

/**
 * Paddle's default payment link (Paddle: Checkout, Checkout settings → https://<app>/pay).
 * No sign-in: people arrive from Paddle's emails and invoices, and Paddle checks who pays.
 */
export default async function PayPage({ searchParams }: { searchParams: Promise<{ _ptxn?: string }> }) {
  const [{ _ptxn }, services] = await Promise.all([searchParams, getServices()]);
  const paddle = services.billing.paddleClient();
  if (!paddle) notFound();
  return (
    <AuthShell title="Payment" subtitle="Tapry's payments are handled by Paddle, our payment provider.">
      <PaddlePay clientToken={paddle.clientToken} sandbox={paddle.sandbox} hasTransaction={!!_ptxn && /^txn_[a-z0-9]+$/.test(_ptxn)} />
      <p className="text-center text-sm text-muted">
        <Link className={link} href="/settings?tab=plan">
          Your plan
        </Link>
      </p>
    </AuthShell>
  );
}
