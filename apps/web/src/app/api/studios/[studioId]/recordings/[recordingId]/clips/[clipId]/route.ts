import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ studioId: string; recordingId: string; clipId: string }> }) {
  return api.deleteClip(req, await ctx.params);
}
