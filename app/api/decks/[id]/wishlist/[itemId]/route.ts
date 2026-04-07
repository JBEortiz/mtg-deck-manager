import { requireApiUser } from "@/lib/server/auth-route";
import { deleteDeckWishlistItem } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function DELETE(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id, itemId } = await params;
  const result = await deleteDeckWishlistItem(Number(id), Number(itemId), `/api/decks/${id}/wishlist/${itemId}`, auth.user.id);
  if (result === null) {
    return new Response(null, { status: 204 });
  }

  return toRouteResponse(result);
}
