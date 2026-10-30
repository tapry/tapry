import Link from "next/link";
import { notFound } from "next/navigation";
import { HostHeader } from "@/components/host-header";
import { RecordingsList } from "@/components/recordings-list";
import { DeleteStudioButton, InviteLink, OpenStudioButton, StudioSettingsForm } from "@/components/studio-forms";
import { Card, Page } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { getServices } from "@/server/context";
import { isApiError } from "@/server/errors";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";

async function loadStudio(studioId: string) {
  const user = await requireUser();
  const services = await getServices();
  const studio = await services.studios.get(user, studioId).catch((err) => {
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  });
  return { user, studio, services };
}

export async function generateMetadata({ params }: { params: Promise<{ studioId: string }> }) {
  return { title: (await loadStudio((await params).studioId)).studio.name };
}

export default async function StudioPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { user, studio, services } = await loadStudio((await params).studioId);
  const recordings = await services.processing.listForStudio(user, studio.id);
  const bytes = recordings.reduce((n, r) => n + r.bytes, 0);

  return (
    <>
      <HostHeader user={user} />
      <Page>
        <Link href="/studios" className="text-sm text-muted hover:text-text">
          ← Studios
        </Link>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">{studio.name}</h1>
          <OpenStudioButton studioId={studio.id} />
        </div>

        <Card className="mt-6 space-y-3">
          <h2 className="font-medium">Guest link</h2>
          <p className="text-sm text-muted">
            Send this to your guests. They join from their browser, with no account or install. They can join once
            you've entered the studio.
          </p>
          <InviteLink studioId={studio.id} inviteCode={studio.inviteCode} />
        </Card>

        <Card className="mt-6 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Recordings</h2>
            {recordings.length > 0 && (
              <span className="text-sm text-muted" data-testid="studio-bytes">
                {formatBytes(bytes)} in storage
              </span>
            )}
          </div>
          <RecordingsList studioId={studio.id} initial={recordings} />
        </Card>

        <Card className="mt-6 space-y-4">
          <h2 className="font-medium">Settings</h2>
          <StudioSettingsForm studioId={studio.id} name={studio.name} settings={studio.settings} />
        </Card>

        <Card className="mt-6 space-y-3">
          <h2 className="font-medium">Delete studio</h2>
          <p className="text-sm text-muted">
            Removes the studio, its guest link and every recording in it, files included.
          </p>
          <DeleteStudioButton studioId={studio.id} name={studio.name} recordings={recordings.length} />
        </Card>
      </Page>
    </>
  );
}
