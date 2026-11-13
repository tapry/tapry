import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ recordingId: string; commentId: string }> }) {
  return api.deleteComment(req, await ctx.params);
}
