import { api } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return api.aiNotes(req, {});
}

export async function PUT(req: Request) {
  return api.setAiNotes(req, {});
}
