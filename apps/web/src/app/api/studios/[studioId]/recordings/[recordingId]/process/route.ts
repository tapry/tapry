import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ studioId: string; recordingId: string }> }) {
  return api.processRecording(req, await ctx.params);
}
