import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studioId: string; recordingId: string; format: string }> }) {
  return api.downloadTimeline(req, await ctx.params);
}
