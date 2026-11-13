import { NewStudioForm } from "@/components/new-studio-form";
import { EmberPage } from "@/components/ui-extra";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "New studio" };

export default async function NewStudioPage() {
  const user = await requireUser();
  const services = await getServices();
  const studios = await services.studios.list(user);
  return (
    <EmberPage>
      <main className="flex w-full justify-center">
        <NewStudioForm hostName={user.name} firstStudio={studios.length === 0} can4k={await services.billing.allows4k(user.accountId)} />
      </main>
    </EmberPage>
  );
}
