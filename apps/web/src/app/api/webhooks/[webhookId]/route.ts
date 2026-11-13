import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ webhookId: string }> }) {
  return api.deleteWebhook(req, await ctx.params);
}
