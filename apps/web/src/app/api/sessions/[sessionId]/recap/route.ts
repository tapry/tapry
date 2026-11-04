import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  return api.recapStatus(req, await ctx.params);
}

export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  return api.requestRecap(req, await ctx.params);
}
