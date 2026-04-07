import { requireApiUser } from "@/lib/server/auth-route";
import { refreshDeckWishlistPricing } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const result = await refreshDeckWishlistPricing(Number(id), `/api/decks/${id}/wishlist/refresh`, auth.user.id);
  return toRouteResponse(result);
}
