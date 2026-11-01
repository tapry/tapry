import { redirect } from "next/navigation";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";

/** The newest show, or straight to creating the first one. */
export default async function ShowsPage() {
  const user = await requireUser();
  const shows = await (await getServices()).studios.list(user);
  redirect(shows.length > 0 ? `/shows/${shows[0]!.id}` : "/shows/new");
}
