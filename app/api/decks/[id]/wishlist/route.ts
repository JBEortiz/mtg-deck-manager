import { requireApiUser } from "@/lib/server/auth-route";
import { addDeckWishlistItem, listDeckWishlist } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const url = new URL(request.url);
  const result = await listDeckWishlist(Number(id), url.searchParams.get("sort"), `/api/decks/${id}/wishlist`, auth.user.id);
  return toRouteResponse(result);
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const payload = await request.json().catch(() => ({}));
  const result = await addDeckWishlistItem(Number(id), payload, `/api/decks/${id}/wishlist`, auth.user.id);
  return toRouteResponse(result, 201);
}
