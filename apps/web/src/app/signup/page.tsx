import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getServices } from "@/server/context";
import { currentUser, isFreshInstall } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/studios");
  return (
    <AuthShell title="Create your account" subtitle="It takes less than a minute. Guests never need one.">
      <AuthForm mode="signup" firstAccount={await isFreshInstall()} setupRequired={(await getServices()).auth.setupRequired} />
    </AuthShell>
  );
}
