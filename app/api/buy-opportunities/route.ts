import { requireApiUser } from "@/lib/server/auth-route";
import { listBuyOpportunities } from "@/lib/server/deck-wishlist";
import { toRouteResponse } from "@/lib/server/mtg-domain";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const url = new URL(request.url);
  const result = await listBuyOpportunities({
    sort: url.searchParams.get("sort"),
    signal: url.searchParams.get("signal"),
    deckId: url.searchParams.get("deckId"),
    historyStatus: url.searchParams.get("historyStatus")
  }, "/api/buy-opportunities", auth.user.id);

  return toRouteResponse(result);
}
