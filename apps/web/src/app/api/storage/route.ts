import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.storageOverview(req, await ctx.params);
}
