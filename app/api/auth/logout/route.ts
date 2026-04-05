import { clearCurrentSession } from "@/lib/server/auth";

export async function POST() {
  await clearCurrentSession();
  return Response.json({ ok: true });
}
