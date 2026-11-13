import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return api.listWebhooks(req, {});
}

export async function POST(req: Request) {
  return api.createWebhook(req, {});
}
