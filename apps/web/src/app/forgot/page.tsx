import Link from "next/link";
import { ForgotForm } from "@/components/account-forms";
import { AuthShell } from "@/components/auth-shell";
import { Notice } from "@/components/ui";
import { getServices } from "@/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot your password" };

/** Ask for a link to set a new password. Only works on a server that sends email. */
export default async function ForgotPage() {
  const { account } = await getServices();
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter the email you log in with and we'll send you a link to set a new one.">
      {account.mailOn ? (
        <ForgotForm />
      ) : (
        <>
          <Notice tone="warn">This server doesn&apos;t send email, so it can&apos;t send you a link. Ask whoever runs it for help with your account.</Notice>
          <p className="text-center text-sm text-muted">
            <Link className="font-medium text-text underline underline-offset-[3px] hover:text-accent-strong" href="/login">
              Back to log in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
