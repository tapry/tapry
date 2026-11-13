import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ recordingId: string }> }) {
  return api.safeTranscript(req, await ctx.params);
}
