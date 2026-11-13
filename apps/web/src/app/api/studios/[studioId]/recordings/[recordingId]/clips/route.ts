import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studioId: string; recordingId: string }> }) {
  return api.listClips(req, await ctx.params);
}

export async function POST(req: Request, ctx: { params: Promise<{ studioId: string; recordingId: string }> }) {
  return api.createClip(req, await ctx.params);
}
