import { requireApiUser } from "@/lib/server/auth-route";
import { parseJsonBody } from "@/lib/server/json-body";
import { importDecklist, toRouteResponse } from "@/lib/server/mtg-domain";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }
  const { id } = await params;

  const body = await parseJsonBody(request, "Payload invalido para importar deck.");
  if (!body.ok) {
    return body.response;
  }

  return toRouteResponse(await importDecklist(Number(id), body.value, `/api/decks/${id}/import`, auth.user.id));
}
