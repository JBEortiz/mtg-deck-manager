import { requireApiUser } from "@/lib/server/auth-route";
import { deleteDeckWishlistPurchase } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string; purchaseId: string }> };

export async function DELETE(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id, purchaseId } = await params;
  const result = await deleteDeckWishlistPurchase(Number(id), Number(purchaseId), `/api/decks/${id}/purchases/${purchaseId}`, auth.user.id);
  if (result === null) {
    return new Response(null, { status: 204 });
  }

  return toRouteResponse(result);
}
