import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return api.invitation(req, await ctx.params);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return api.acceptInvite(req, await ctx.params);
}
