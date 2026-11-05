import { redirect } from "next/navigation";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";

/** The newest studio, or straight to creating the first one. */
export default async function ShowsPage() {
  const user = await requireUser();
  const studios = await (await getServices()).studios.list(user);
  redirect(studios.length > 0 ? `/studios/${studios[0]!.id}` : "/studios/new");
}
