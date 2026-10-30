import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { currentUser, isFreshInstall } from "@/server/page-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await currentUser()) redirect("/studios");
  const fresh = await isFreshInstall();
  return (
    <Page narrow>
      <h1 className="text-3xl font-semibold tracking-tight">OpenTake</h1>
      <p className="mt-2 text-muted">Studio-quality remote recording you can own.</p>
      <Card className="mt-8 space-y-4">
        {fresh ? (
          <>
            <p className="text-sm">
              This server has no accounts yet. The first account you create becomes the admin.
            </p>
            <Link className="inline-flex h-10 items-center rounded-md bg-text px-4 text-sm font-medium text-bg" href="/signup">
              Create admin account
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm">Hosts sign in to manage studios. Guests: open the invite link your host sent you.</p>
            <Link className="inline-flex h-10 items-center rounded-md bg-text px-4 text-sm font-medium text-bg" href="/login">
              Sign in
            </Link>
          </>
        )}
      </Card>
    </Page>
  );
}
