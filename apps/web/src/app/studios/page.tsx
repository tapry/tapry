import Link from "next/link";
import { HostHeader } from "@/components/host-header";
import { CreateStudioForm } from "@/components/studio-forms";
import { Card, Page } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studios" };

export default async function StudiosPage() {
  const user = await requireUser();
  const studios = await (await getServices()).studios.list(user);
  return (
    <>
      <HostHeader user={user} />
      <Page>
        <h1 className="text-2xl font-semibold tracking-tight">Studios</h1>
        <p className="mt-1 text-sm text-muted">
          A studio is a reusable room with its own guest link.
          {studios.length > 0 && (
            <>
              {" "}
              Your recordings use <span data-testid="storage-total">{formatBytes(studios.reduce((n, s) => n + s.bytes, 0))}</span>{" "}
              of storage.
            </>
          )}
        </p>
        <Card className="mt-6">
          <CreateStudioForm />
        </Card>
        {studios.length > 0 && (
          <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {studios.map((s) => (
              <li key={s.id}>
                <Link href={`/studios/${s.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-surface-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-right text-sm text-muted">
                    {s.recordings} recording{s.recordings === 1 ? "" : "s"} · {formatBytes(s.bytes)}
                    <span className="block text-xs">
                      {s.settings.videoQuality} · up to {s.settings.maxGuests} guest{s.settings.maxGuests === 1 ? "" : "s"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}
