import { requireApiUser } from "@/lib/server/auth-route";
import { getDeck, toRouteResponse, updateDeck } from "@/lib/server/mtg-domain";

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
  return toRouteResponse(await updateDeck(Number(id), await request.json(), `/api/decks/${id}`, auth.user.id));
}
