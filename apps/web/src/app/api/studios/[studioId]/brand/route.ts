import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.getBrand(req, await ctx.params);
}

export async function PUT(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.setBrand(req, await ctx.params);
}
