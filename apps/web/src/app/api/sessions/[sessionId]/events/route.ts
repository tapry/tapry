import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  return api.sessionEvents(req, await ctx.params);
}
