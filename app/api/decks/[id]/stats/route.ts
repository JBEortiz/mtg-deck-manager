import { requireApiUser } from "@/lib/server/auth-route";
import { getDeckStats, toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;
  return toRouteResponse(await getDeckStats(Number(id), `/api/decks/${id}`, auth.user.id));
}
