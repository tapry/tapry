import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  return api.createTrack(req, await ctx.params);
}
