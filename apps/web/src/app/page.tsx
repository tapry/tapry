import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/ui-extra";
import { currentUser, isFreshInstall } from "@/server/page-auth";

export const dynamic = "force-dynamic";

const cta =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink text-[14.5px] font-medium text-ink-text transition-colors hover:bg-ink-hover";

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
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13.5px] text-text-2">
        <Icon name="link" />
        Got a guest link? Open it to join. Guests never need an account.
      </div>
    </AuthShell>
  );
}
