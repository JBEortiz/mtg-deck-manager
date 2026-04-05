import { requireApiUser } from "@/lib/server/auth-route";
import { deleteDeckCard, toRouteResponse, updateDeckCard } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string; cardId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id, cardId } = await params;
  return toRouteResponse(await updateDeckCard(Number(id), Number(cardId), await request.json(), `/api/decks/${id}/cards/${cardId}`, auth.user.id));
}

export async function DELETE(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id, cardId } = await params;
  const result = await deleteDeckCard(Number(id), Number(cardId), `/api/decks/${id}/cards/${cardId}`, auth.user.id);
  if (result === null) {
    return new Response(null, { status: 204 });
  }
  return toRouteResponse(result);
}
