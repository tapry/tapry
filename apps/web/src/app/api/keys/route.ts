import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return api.listApiKeys(req, {});
}

export async function POST(req: Request) {
  return api.createApiKey(req, {});
}
