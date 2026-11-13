import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ recordingId: string }> }) {
  return api.listComments(req, await ctx.params);
}

export async function POST(req: Request, ctx: { params: Promise<{ recordingId: string }> }) {
  return api.addComment(req, await ctx.params);
}
