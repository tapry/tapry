import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.login(req, await ctx.params);
}
