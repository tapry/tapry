import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.setAvatar(req, await ctx.params);
}

export async function DELETE(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.removeAvatar(req, await ctx.params);
}
