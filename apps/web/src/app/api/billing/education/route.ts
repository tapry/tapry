import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.education(req, await ctx.params);
}

export async function POST(req: Request, ctx: { params: Promise<Record<string, never>> }) {
  return api.requestEducation(req, await ctx.params);
}
