import { buildSpringCardQuery } from "@/lib/deck-browsing";
import "server-only";
import type { Card, CardFilters, Deck, DeckPassport, DeckPortfolio, DeckStats, DeckValueTracker, MulliganSample } from "@/lib/types";
import { getDeck, getDeckPassport, getDeckPortfolio, getDeckStats, getDeckValue, getHealthText, getMulliganSample, listDeckCards, listDecks } from "@/lib/server/mtg-domain";

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
