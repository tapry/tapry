import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { PaddleCheckout } from "@/components/paddle-checkout";
import { Notice } from "@/components/ui";
import { getServices } from "@/server/context";
import { isApiError } from "@/server/errors";
import { currentUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout", robots: { index: false } };

const link = "font-medium text-text underline underline-offset-[3px] hover:text-accent-strong";

/** Tapry Cloud: buy a plan. Opens the payment provider's checkout for the signed-in account. */
export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ plan: string }>; searchParams: Promise<{ yearly?: string }> }) {
  const [{ plan }, { yearly }, services, user] = await Promise.all([params, searchParams, getServices(), currentUser()]);
  // Someone arriving from the website's pricing page has no account yet: sign up, then come back here.
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/checkout/${plan}${yearly === "1" ? "?yearly=1" : ""}`)}`);
  let checkout;
  try {
    checkout = services.billing.checkout(user, plan, yearly === "1");
  } catch (err) {
    if (isApiError(err) && err.status === 403) {
      return (
        <AuthShell title="Only the owner can change the plan" subtitle="You're a member of this account. Ask its owner to move it to another plan.">
          <Link className={link} href="/settings?tab=plan">
            Back to the plan
          </Link>
        </AuthShell>
      );
    }
    notFound();
  }
  const price = checkout.plan.monthlyUsd === null ? "" : checkout.yearly ? `$${(checkout.plan.monthlyUsd * 10).toLocaleString("en-US")} a year` : `$${checkout.plan.monthlyUsd} a month`;
  return (
    <AuthShell title={`${checkout.plan.name} plan`} subtitle={`${price}. You can cancel at any time; the plan then runs to the end of the period you paid for.`}>
      {checkout.sandbox && <Notice tone="warn">Test mode: no real money is taken.</Notice>}
      <PaddleCheckout priceId={checkout.priceId} clientToken={checkout.clientToken} sandbox={checkout.sandbox} accountId={checkout.accountId} email={checkout.email} discountId={await services.billing.checkoutDiscount(user)} />
      <p className="text-center text-sm text-muted">
        <Link className={link} href="/settings?tab=plan">
          Back to the plan
        </Link>
      </p>
    </AuthShell>
  );
}
