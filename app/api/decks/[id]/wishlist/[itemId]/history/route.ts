import { requireApiUser } from "@/lib/server/auth-route";
import { getDeckWishlistItemHistory } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function GET(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id, itemId } = await params;
  const result = await getDeckWishlistItemHistory(Number(id), Number(itemId), `/api/decks/${id}/wishlist/${itemId}/history`, auth.user.id);
  return toRouteResponse(result);
}
