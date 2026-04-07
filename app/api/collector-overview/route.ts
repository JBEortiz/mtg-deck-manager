import { requireApiUser } from "@/lib/server/auth-route";
import { listCollectorOverview } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const url = new URL(request.url);
  const result = await listCollectorOverview({
    sort: url.searchParams.get("sort"),
    deckId: url.searchParams.get("deckId"),
    profitability: url.searchParams.get("profitability"),
    priceData: url.searchParams.get("priceData")
  }, "/api/collector-overview", auth.user.id);

  return toRouteResponse(result);
}
