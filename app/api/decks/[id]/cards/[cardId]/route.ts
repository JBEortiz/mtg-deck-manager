import { requireApiUser } from "@/lib/server/auth-route";
import { parseJsonBody } from "@/lib/server/json-body";
import { deleteDeckCard, toRouteResponse, updateDeckCard } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string; cardId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id, cardId } = await params;

  const body = await parseJsonBody(request, "Payload invalido para actualizar carta.");
  if (!body.ok) {
    return body.response;
  }

  return toRouteResponse(await updateDeckCard(Number(id), Number(cardId), body.value, `/api/decks/${id}/cards/${cardId}`, auth.user.id));
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
