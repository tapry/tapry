import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string; recordingId: string }> }) {
  return api.stopRecording(req, await ctx.params);
}
