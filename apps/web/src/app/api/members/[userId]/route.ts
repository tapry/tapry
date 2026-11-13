import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  return api.removeMember(req, await ctx.params);
}
