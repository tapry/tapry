import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ recordingId: string }> }) {
  return api.getRecording(req, await ctx.params);
}
