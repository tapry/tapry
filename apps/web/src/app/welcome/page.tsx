import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { WelcomeWait } from "@/components/welcome-wait";
import { Notice } from "@/components/ui";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome", robots: { index: false } };

/**
 * Where Paddle's checkout lands after a payment. The plan itself changes when Paddle's webhook
 * confirms the subscription, usually within seconds: until then this page checks again by itself.
 */
export default async function WelcomePage() {
  const user = await requireUser();
  const services = await getServices();
  const billing = services.billing.cloud ? await services.billing.overview(user) : null;
  const paid = !!billing && billing.plan.id !== "free";
  return (
    <AuthShell title={paid ? `Welcome to ${billing!.plan.name}` : "Thank you"} subtitle={paid ? "Your plan is active. You can start recording straight away." : "Your payment is being confirmed."}>
      {paid ? (
        <Notice tone="ok" data-testid="welcome-plan">
          {billing!.plan.hours === null ? "No limit on recording hours." : `${billing!.plan.hours} recording hours a month.`} Paddle emails you the receipt.
        </Notice>
      ) : (
        <WelcomeWait />
      )}
      <Link href="/studios" className="inline-flex h-[38px] w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-ink-text transition-colors hover:bg-ink-hover">
        Go to your studios
      </Link>
    </AuthShell>
  );
}
