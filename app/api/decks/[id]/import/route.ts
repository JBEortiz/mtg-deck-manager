import { requireApiUser } from "@/lib/server/auth-route";
import { importDecklist, toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;
  return toRouteResponse(await importDecklist(Number(id), await request.json(), `/api/decks/${id}/import`, auth.user.id));
}
