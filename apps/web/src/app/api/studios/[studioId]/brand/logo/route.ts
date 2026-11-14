import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.setBrandLogo(req, await ctx.params);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.removeBrandLogo(req, await ctx.params);
}
