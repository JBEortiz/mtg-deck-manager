import { requireApiUser } from "@/lib/server/auth-route";
import { parseJsonBody } from "@/lib/server/json-body";
import { createDeck, listDecks, toRouteResponse } from "@/lib/server/mtg-domain";

export async function GET() {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  return toRouteResponse(await listDecks(auth.user.id));
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const body = await parseJsonBody(request, "Payload invalido para crear deck.");
  if (!body.ok) {
    return body.response;
  }

  return toRouteResponse(await createDeck(body.value, "/api/decks", auth.user.id), 201);
}
