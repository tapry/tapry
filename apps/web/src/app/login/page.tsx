import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getServices } from "@/server/context";
import { currentUser, safeNext } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next ?? "/studios");
  const services = await getServices();
  return (
    <AuthShell title="Welcome back" subtitle="Log in to open your studios.">
      <AuthForm mode="login" canReset={services.account.mailOn} openSignup={services.auth.signupOpen} next={next} />
    </AuthShell>
  );
}
