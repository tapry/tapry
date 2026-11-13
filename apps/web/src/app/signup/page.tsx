import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getServices } from "@/server/context";
import { currentUser, isFreshInstall, safeNext } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next ?? "/studios");
  return (
    <AuthShell title="Create your account" subtitle="It takes less than a minute. Guests never need one.">
      <AuthForm mode="signup" firstAccount={await isFreshInstall()} setupRequired={(await getServices()).auth.setupRequired} next={next} />
    </AuthShell>
  );
}
