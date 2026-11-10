import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { currentUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/studios");
  return (
    <AuthShell title="Welcome back" subtitle="Log in to open your studios.">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
