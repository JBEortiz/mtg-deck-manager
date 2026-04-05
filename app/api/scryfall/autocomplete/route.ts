import { autocompleteCards, toErrorResponse } from "@/lib/scryfall/server";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query") ?? "";
    return Response.json(await autocompleteCards(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
