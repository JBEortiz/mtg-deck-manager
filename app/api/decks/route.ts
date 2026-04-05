import { requireApiUser } from "@/lib/server/auth-route";
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
  return toRouteResponse(await createDeck(await request.json(), "/api/decks", auth.user.id), 201);
}
