import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studioId: string; recordingId: string; outputId: string }> }) {
  return api.downloadOutput(req, await ctx.params);
}
