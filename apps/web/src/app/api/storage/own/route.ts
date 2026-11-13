import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.ownStorage(req, await ctx.params);
}

export async function PUT(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.saveOwnStorage(req, await ctx.params);
}

export async function DELETE(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.removeOwnStorage(req, await ctx.params);
}
