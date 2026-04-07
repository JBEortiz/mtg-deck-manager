import { requireApiUser } from "@/lib/server/auth-route";
import { getCardDetail } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ identity: string }> };

export async function GET(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { identity } = await params;
  const result = await getCardDetail(identity, `/api/cards/${identity}`, auth.user.id);
  return toRouteResponse(result);
}
