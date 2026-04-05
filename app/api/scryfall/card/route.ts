import { getCardByExactName, toErrorResponse } from "@/lib/scryfall/server";

export async function GET(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    return Response.json(await getCardByExactName(name));
  } catch (error) {
    return toErrorResponse(error);
  }
}
