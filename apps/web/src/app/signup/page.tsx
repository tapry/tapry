import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Page } from "@/components/ui";
import { currentUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/studios");
  return (
    <Page narrow>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Create account</h1>
      <AuthForm mode="signup" />
    </Page>
  );
}
