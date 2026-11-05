import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { currentUser, isFreshInstall } from "@/server/page-auth";

export const dynamic = "force-dynamic";

const cta =
  "inline-flex h-[54px] w-full items-center justify-center rounded-xl bg-accent text-[17px] font-semibold text-accent-text shadow-[0_10px_22px_-12px_var(--accent)] hover:bg-accent-hover";

export default async function Home() {
  if (await currentUser()) redirect("/studios");
  const fresh = await isFreshInstall();
  return fresh ? (
    <AuthShell
      title="Your studio is ready"
      subtitle="This server has no accounts yet. The first account you create is in charge: it can create studios and invite guests."
    >
      <Link className={cta} href="/signup">
        Create admin account
      </Link>
    </AuthShell>
  ) : (
    <AuthShell
      title="The recording studio you own"
      subtitle="Hosts log in to manage their studios. Guests: open the invite link your host sent you."
    >
      <Link className={cta} href="/login">
        Log in
      </Link>
    </AuthShell>
  );
}
