import { NewShowForm } from "@/components/new-show-form";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "New show" };

export default async function NewShowPage() {
  const user = await requireUser();
  const shows = await (await getServices()).studios.list(user);
  return (
    <main
      className="flex min-h-dvh justify-center bg-canvas px-4 py-[clamp(24px,5vw,64px)]"
      style={{ backgroundImage: "radial-gradient(120% 60% at 50% 0%, var(--accent-soft) 0%, transparent 60%)" }}
    >
      <NewShowForm hostName={user.name} firstShow={shows.length === 0} />
    </main>
  );
}
