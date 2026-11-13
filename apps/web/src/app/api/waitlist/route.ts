import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return api.joinWaitlist(req, {});
}

export async function OPTIONS(req: Request) {
  return api.waitlistPreflight(req, {});
}
