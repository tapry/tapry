import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studioId: string }> }) {
  return api.brandLogo(req, await ctx.params);
}
