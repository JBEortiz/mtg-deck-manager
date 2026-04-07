import { requireApiUser } from "@/lib/server/auth-route";
import { createDeckWishlistPurchase } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const payload = await request.json().catch(() => ({}));
  const result = await createDeckWishlistPurchase(Number(id), payload, `/api/decks/${id}/purchases`, auth.user.id);
  return toRouteResponse(result, 201);
}
