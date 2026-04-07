import { requireApiUser } from "@/lib/server/auth-route";
import { parseJsonBody } from "@/lib/server/json-body";
import { deleteDeck, getDeck, toRouteResponse, updateDeck } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;
  return toRouteResponse(await getDeck(Number(id), `/api/decks/${id}`, auth.user.id));
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;

  const body = await parseJsonBody(request, "Payload invalido para actualizar deck.");
  if (!body.ok) {
    return body.response;
  }

  return toRouteResponse(await updateDeck(Number(id), body.value, `/api/decks/${id}`, auth.user.id));
}

export async function DELETE(_: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;
  return toRouteResponse(await deleteDeck(Number(id), `/api/decks/${id}`, auth.user.id));
}
