import { searchCards, toErrorResponse } from "@/lib/scryfall/server";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("query") ?? "";
    const limitParam = searchParams.get("limit");
    const limit = limitParam == null ? 8 : Number.parseInt(limitParam, 10);
    return Response.json(await searchCards(query, limit));
  } catch (error) {
    return toErrorResponse(error);
  }
}
