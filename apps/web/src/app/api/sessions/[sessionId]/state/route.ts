import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  return api.sessionState(req, await ctx.params);
}
