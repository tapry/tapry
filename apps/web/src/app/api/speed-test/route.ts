import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return api.publicSpeedTest(req, {});
}

export async function OPTIONS(req: Request) {
  return api.publicSpeedTestPreflight(req, {});
}
