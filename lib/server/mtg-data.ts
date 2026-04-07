import { buildSpringCardQuery } from "@/lib/deck-browsing";
import "server-only";
import type { BuyOpportunities, Card, CardDetail, CardFilters, CollectorOverview, Deck, DeckPassport, DeckPortfolio, DeckStats, DeckValueTracker, DeckWishlist, MulliganSample } from "@/lib/types";
import { getDeck, getDeckPassport, getDeckPortfolio, getDeckStats, getDeckValue, getHealthText, getMulliganSample, listDeckCards, listDecks } from "@/lib/server/mtg-domain";
import { getCardDetail, listBuyOpportunities, listCollectorOverview, listDeckWishlist } from "@/lib/server/deck-wishlist";

function isApiRouteError(result: unknown): result is { status: number; body: Record<string, unknown> } {
  return Boolean(
    result
    && typeof result === "object"
    && "status" in result
    && typeof (result as { status?: unknown }).status === "number"
    && "body" in result
  );
}

export async function getHealth() {
  return getHealthText();
}

export async function getDecks() {
  return listDecks() as Promise<Deck[]>;
}

export async function getDecksByOwner(ownerUserId: number) {
  return listDecks(ownerUserId) as Promise<Deck[]>;
}

export async function getDeckById(deckId: number, ownerUserId: number) {
  const result = await getDeck(deckId, `/api/decks/${deckId}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Deck request failed with status ${result.status}`);
  }
  return result as Deck;
}

export async function getDeckCards(deckId: number, filters: Partial<CardFilters> = {}, ownerUserId: number) {
  const params = buildSpringCardQuery(filters);
  const result = await listDeckCards(deckId, params, `/api/decks/${deckId}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Card request failed with status ${result.status}`);
  }
  return result as Card[];
}

export async function getDeckStatsById(deckId: number, ownerUserId: number) {
  const result = await getDeckStats(deckId, `/api/decks/${deckId}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Stats request failed with status ${result.status}`);
  }
  return result as DeckStats;
}

export async function getDeckPassportById(deckId: number, ownerUserId: number) {
  const result = await getDeckPassport(deckId, `/api/decks/${deckId}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Passport request failed with status ${result.status}`);
  }
  return result as DeckPassport;
}

export async function getMulliganSampleById(deckId: number, ownerUserId: number) {
  const result = await getMulliganSample(deckId, `/api/decks/${deckId}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Mulligan request failed with status ${result.status}`);
  }
  return result as MulliganSample;
}

export async function getDeckValueById(deckId: number, ownerUserId: number) {
  const result = await getDeckValue(deckId, `/api/decks/${deckId}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Deck value request failed with status ${result.status}`);
  }
  return result as DeckValueTracker;
}

export async function getDeckPortfolioByOwner(ownerUserId: number) {
  return getDeckPortfolio(ownerUserId) as Promise<DeckPortfolio>;
}

export async function getDeckWishlistById(deckId: number, ownerUserId: number, sortBy: string | null = "best-opportunity") {
  const result = await listDeckWishlist(deckId, sortBy, `/api/decks/${deckId}/wishlist`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Wishlist request failed with status ${result.status}`);
  }

  return result as DeckWishlist;
}

export async function getBuyOpportunitiesByOwner(
  ownerUserId: number,
  options: {
    sort?: string | null;
    signal?: string | null;
    deckId?: string | number | null;
    historyStatus?: string | null;
  } = {}
) {
  const result = await listBuyOpportunities(options, "/api/buy-opportunities", ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Buy opportunities request failed with status ${result.status}`);
  }

  return result as BuyOpportunities;
}

export async function getCollectorOverviewByOwner(
  ownerUserId: number,
  options: {
    sort?: string | null;
    deckId?: string | number | null;
    profitability?: string | null;
    priceData?: string | null;
  } = {}
) {
  const result = await listCollectorOverview(options, "/api/collector-overview", ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Collector overview request failed with status ${result.status}`);
  }
  return result as CollectorOverview;
}

export async function getCardDetailByIdentity(identity: string, ownerUserId: number) {
  const result = await getCardDetail(identity, `/api/cards/${encodeURIComponent(identity)}`, ownerUserId);
  if (isApiRouteError(result)) {
    throw new Error(`Card detail request failed with status ${result.status}`);
  }
  return result as CardDetail;
}
