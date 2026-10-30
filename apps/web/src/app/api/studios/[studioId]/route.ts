import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.getStudio(req, await ctx.params);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.updateStudio(req, await ctx.params);
}
