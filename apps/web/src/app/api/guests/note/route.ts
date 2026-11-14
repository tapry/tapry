import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.setGuestNote(req, await ctx.params);
}
