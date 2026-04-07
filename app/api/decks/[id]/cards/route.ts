import { requireApiUser } from "@/lib/server/auth-route";
import { parseJsonBody } from "@/lib/server/json-body";
import { addDeckCard, listDeckCards, toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;
  return toRouteResponse(await listDeckCards(Number(id), new URL(request.url).searchParams, `/api/decks/${id}`, auth.user.id));
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;

  const body = await parseJsonBody(request, "Payload invalido para agregar carta.");
  if (!body.ok) {
    return body.response;
  }

  return toRouteResponse(await addDeckCard(Number(id), body.value, `/api/decks/${id}/cards`, auth.user.id), 201);
}
