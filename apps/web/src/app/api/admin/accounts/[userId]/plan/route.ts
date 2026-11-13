import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  return api.adminSetPlan(req, await ctx.params);
}
