import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ShowView } from "@/components/show-view";
import { getServices } from "@/server/context";
import { isApiError } from "@/server/errors";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";

async function load(showId: string) {
  const user = await requireUser();
  const services = await getServices();
  const show = await services.studios.get(user, showId).catch((err) => {
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  });
  return { user, show, services };
}

export async function generateMetadata({ params }: { params: Promise<{ showId: string }> }) {
  return { title: (await load((await params).showId)).show.name };
}

export default async function ShowPage({ params }: { params: Promise<{ showId: string }> }) {
  const { user, show, services } = await load((await params).showId);
  const [shows, episodes, checks] = await Promise.all([
    services.studios.list(user),
    services.processing.listForStudio(user, show.id),
    services.studios.techChecks(user, show.id),
  ]);
  return (
    <DashboardShell user={user} shows={shows} currentId={show.id} title={show.name}>
      <ShowView
        show={show}
        episodes={episodes}
        checks={checks}
        hostName={user.name}
        shows={shows.map((s) => ({ id: s.id, name: s.name, bytes: s.bytes }))}
      />
    </DashboardShell>
  );
}
