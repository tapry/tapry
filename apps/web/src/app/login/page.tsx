import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Page } from "@/components/ui";
import { currentUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/studios");
  return (
    <Page narrow>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sign in</h1>
      <AuthForm mode="login" />
    </Page>
  );
}
