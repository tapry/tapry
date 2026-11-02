import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ inviteCode: string }> }) {
  return api.reportTechCheck(req, await ctx.params);
}
