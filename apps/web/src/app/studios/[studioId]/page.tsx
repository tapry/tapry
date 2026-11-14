import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { StudioView } from "@/components/studio-view";
import { getServices } from "@/server/context";
import { isApiError } from "@/server/errors";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";

async function load(studioId: string) {
  const user = await requireUser();
  const services = await getServices();
  const studio = await services.studios.get(user, studioId).catch((err) => {
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  });
  return { user, studio, services };
}

export async function generateMetadata({ params }: { params: Promise<{ studioId: string }> }) {
  return { title: (await load((await params).studioId)).studio.name };
}

export default async function StudioPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { user, studio, services } = await load((await params).studioId);
  const [studios, recordings, checks, guide, can4k, solo, brand] = await Promise.all([
    services.studios.list(user),
    services.processing.listForStudio(user, studio.id),
    services.studios.techChecks(user, studio.id),
    services.guide.get(user, studio.id),
    services.billing.allows4k(user.accountId),
    services.studios.solo(user, studio.id),
    services.brand.view(user, studio.id),
  ]);
  return (
    <DashboardShell user={user} studios={studios} currentId={studio.id} title={studio.name}>
      <StudioView
        studio={studio}
        recordings={recordings}
        checks={checks}
        hostName={user.name}
        guide={guide}
        solo={solo}
        brand={brand}
        can4k={can4k}
        studios={studios.map((s) => ({ id: s.id, name: s.name, bytes: s.bytes }))}
      />
    </DashboardShell>
  );
}
