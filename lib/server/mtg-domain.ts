import "server-only";

import { countPendingMetadataCards, findReusableMetadata, mergeReusableMetadata, needsMetadataEnrichment, resolveMetadataLookup, selectMetadataEnrichmentCandidates } from "@/lib/card-metadata";
import { inferCommanderFromResolvedEntries, parseDecklistText } from "@/lib/decklist-import";
import { resolveImportEntriesWithFallback } from "@/lib/import-resolution";
import type { Card, CardLookupResult, Deck, DeckPortfolio, DeckStats, DeckValueTracker, ImportResult } from "@/lib/types";
import { buildDeckPassport, buildMulliganSample } from "@/lib/server/mtg-analytics";
import { ensureDeckValueTracker, ensurePortfolioValueTracker, initializeDeckValueTracking, refreshDeckValueSnapshotsInDatabase } from "@/lib/server/deck-value";
import { createOwnedDeckRecord, ensureOwnedResource, filterOwnedResources, notFoundForOwnership, requireAuthenticatedOwner } from "@/lib/server/deck-ownership";
import { readDatabase, type StoredCard, type StoredDeck, withDatabaseWrite } from "@/lib/server/mtg-store";
import { getCardByExactName, getCardByFuzzyName, searchCards as searchScryfallCards } from "@/lib/scryfall/server";

export type ApiRouteError = {
  body: Record<string, unknown>;
  status: number;
};

function normalize(value: string | null | undefined): string {
  return value == null ? "" : value.trim().toLowerCase();
}

function normalizeNullable(value: unknown): string | null {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const next = normalizeNullable(value);
    if (next) {
      return next;
    }
  }
  return null;
}

function quantity(card: { quantity: number | null | undefined }) {
  return card.quantity == null ? 0 : Math.max(0, card.quantity);
}

function splitColors(colors: string | null | undefined) {
  if (!colors) {
    return [];
  }

  return colors
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function springErrorBody(status: number, error: string, path: string) {
  return {
    timestamp: new Date().toISOString(),
    status,
    error,
    path
  };
}

function badRequest(path: string): ApiRouteError {
  return {
    status: 400,
    body: springErrorBody(400, "Bad Request", path)
  };
}

function notFound(path: string): ApiRouteError {
  return notFoundForOwnership(path);
}

function deckValidationError(errors: string[]): ApiRouteError {
  return {
    status: 400,
    body: {
      message: "Deck validation failed",
      errors
    }
  };
}

function isCommanderDeck(format: string) {
  return normalize(format) === "commander";
}

function validateCommanderCardTotal(deck: { format: string }, cards: Array<{ quantity: number }>) {
  if (!isCommanderDeck(deck.format)) {
    return null;
  }

  const totalCards = cards.reduce((total, card) => total + quantity(card), 0);
  return totalCards > 100 ? ["Commander decks cannot exceed 100 total cards."] : null;
}

function deckCards(cards: StoredCard[], deckId: number) {
  return cards.filter((card) => card.deckId === deckId).sort((left, right) => left.id - right.id);
}

function hasColor(colors: string, expectedColor: string) {
  return splitColors(colors).some((part) => part.toLowerCase() === expectedColor.trim().toLowerCase());
}

function commanderCoverUrl(deck: StoredDeck, cards: StoredCard[], allCards: StoredCard[] = cards) {
  const commanderName = normalize(resolveDeckCommanderName(deck, cards));

  if (commanderName) {
    for (const card of allCards) {
      const image = firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl);
      if (normalize(card.name) === commanderName && image) {
        return image;
      }
    }
  }

  return null;
}

function firstAvailableCoverUrl(cards: StoredCard[]) {
  for (const card of cards) {
    const image = firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl);
    if (image) {
      return image;
    }
  }

  return null;
}

function toDeckCoverUrl(deck: StoredDeck, cards: StoredCard[], allCards: StoredCard[] = cards) {
  return commanderCoverUrl(deck, cards, allCards) ?? firstAvailableCoverUrl(cards);
}

function inferCommanderFromCards(deck: StoredDeck, cards: StoredCard[]) {
  if (!isCommanderDeck(deck.format)) {
    return null;
  }

  const legendaryCandidates = cards.filter((card) => {
    if (quantity(card) !== 1) {
      return false;
    }

    const typeLine = normalize(card.type);
    return typeLine.includes("legendary") && (typeLine.includes("creature") || typeLine.includes("planeswalker"));
  });

  return legendaryCandidates.length === 1 ? legendaryCandidates[0]?.name ?? null : null;
}

function resolveDeckCommanderName(deck: StoredDeck, cards: StoredCard[]) {
  return firstNonBlank(deck.commander, inferCommanderFromCards(deck, cards));
}

function toDeckResponse(deck: StoredDeck, cards: StoredCard[]): Deck {
  return {
    id: deck.id,
    ownerUserId: deck.ownerUserId,
    name: deck.name,
    format: deck.format,
    commander: deck.commander,
    createdAt: deck.createdAt,
    deckCoverUrl: toDeckCoverUrl(deck, cards)
  };
}

async function toDeckResponseWithCommanderCover(deck: StoredDeck, cards: StoredCard[], allCards: StoredCard[]): Promise<Deck> {
  const preferredCommanderCover = commanderCoverUrl(deck, cards, allCards);
  const fallbackCover = firstAvailableCoverUrl(cards);
  if (preferredCommanderCover || !normalize(deck.commander)) {
    return {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt,
      deckCoverUrl: preferredCommanderCover ?? fallbackCover
    };
  }

  try {
    const commanderLookup = await getCardByExactName(deck.commander);
    return {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt,
      deckCoverUrl: firstNonBlank(commanderLookup.imageNormal, commanderLookup.imageSmall) ?? fallbackCover
    };
  } catch {
    return {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt,
      deckCoverUrl: fallbackCover
    };
  }
}

function toDeckListResponse(deck: StoredDeck, cards: StoredCard[]): Deck {
  return {
    ...toDeckResponse(deck, cards),
    totalCardCount: cards.reduce((total, card) => total + quantity(card), 0),
    cardPreview: cards.slice(0, 5).map((card) => `${card.quantity}x ${card.name}`)
  };
}

function toCardResponse(card: StoredCard): Card {
  return {
    id: card.id,
    name: card.name,
    manaValue: card.manaValue,
    type: card.type,
    colors: card.colors,
    quantity: card.quantity,
    scryfallId: card.scryfallId,
    imageSmall: card.imageSmall,
    imageNormal: card.imageNormal,
    imageUrl: card.imageUrl
  };
}

async function resolveCardMetadata(cardName: string, existing: Omit<StoredCard, "deckId" | "id">) {
  const resolved = {
    ...existing,
    imageUrl: firstNonBlank(existing.imageNormal, existing.imageSmall, existing.imageUrl)
  };

  if (!needsMetadataEnrichment({
    ...resolved,
    name: cardName
  })) {
    return resolved;
  }

  try {
    const metadataLookup = await resolveMetadataLookup(cardName, async (name, mode) => (
      mode === "exact" ? getCardByExactName(name) : getCardByFuzzyName(name)
    ));

    if (!metadataLookup.ok) {
      return resolved;
    }

    const lookup = metadataLookup.lookup;
    return {
      ...resolved,
      manaValue: resolved.manaValue > 0 ? resolved.manaValue : lookup.manaValue,
      type: normalize(resolved.type) && normalize(resolved.type) !== "unknown" ? resolved.type : lookup.type,
      colors: normalize(resolved.colors) !== "colorless" && normalize(resolved.colors) !== "c" ? resolved.colors : lookup.colors,
      scryfallId: resolved.scryfallId ?? normalizeNullable(lookup.scryfallId),
      imageSmall: resolved.imageSmall ?? normalizeNullable(lookup.imageSmall),
      imageNormal: resolved.imageNormal ?? normalizeNullable(lookup.imageNormal),
      imageUrl: firstNonBlank(resolved.imageNormal ?? lookup.imageNormal, resolved.imageSmall ?? lookup.imageSmall, resolved.imageUrl)
    };
  } catch {
    return resolved;
  }
}

function reuseStoredCardMetadata(
  target: Omit<StoredCard, "deckId" | "id">,
  allCards: StoredCard[],
  options?: {
    excludeDeckId?: number;
    excludeCardIds?: number[];
  }
) {
  const excludedIds = new Set(options?.excludeCardIds ?? []);
  const candidates = allCards.filter((candidate) => {
    if (options?.excludeDeckId != null && candidate.deckId === options.excludeDeckId) {
      return false;
    }

    return !excludedIds.has(candidate.id);
  });
  const reusable = findReusableMetadata(target, candidates);
  return reusable ? mergeReusableMetadata(target, reusable) : target;
}

function mergeLookupMetadata(card: StoredCard, lookup: CardLookupResult) {
  return {
    manaValue: lookup.manaValue,
    type: lookup.type,
    colors: lookup.colors || card.colors,
    scryfallId: normalizeNullable(lookup.scryfallId),
    imageSmall: normalizeNullable(lookup.imageSmall),
    imageNormal: normalizeNullable(lookup.imageNormal),
    imageUrl: firstNonBlank(lookup.imageNormal, lookup.imageSmall, card.imageUrl)
  };
}

async function opportunisticallyEnrichDeckMetadata(cards: StoredCard[], allCards: StoredCard[], commanderName?: string | null, limit = 96, concurrency = 8) {
  const candidates = selectMetadataEnrichmentCandidates(cards, commanderName, limit);
  const failuresByReason: Record<string, number> = {};
  const results: Array<{ card: StoredCard; metadata?: ReturnType<typeof mergeLookupMetadata>; failureReason?: string }> = new Array(candidates.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= candidates.length) {
        return;
      }

      const card = candidates[currentIndex];
      const localMetadata = reuseStoredCardMetadata(card, allCards, {
        excludeDeckId: card.deckId,
        excludeCardIds: [card.id]
      });

      if (
        localMetadata.manaValue !== card.manaValue
        || localMetadata.type !== card.type
        || localMetadata.colors !== card.colors
        || localMetadata.scryfallId !== card.scryfallId
        || localMetadata.imageSmall !== card.imageSmall
        || localMetadata.imageNormal !== card.imageNormal
        || localMetadata.imageUrl !== card.imageUrl
      ) {
        results[currentIndex] = {
          card,
          metadata: {
            manaValue: localMetadata.manaValue,
            type: localMetadata.type,
            colors: localMetadata.colors,
            scryfallId: localMetadata.scryfallId,
            imageSmall: localMetadata.imageSmall,
            imageNormal: localMetadata.imageNormal,
            imageUrl: localMetadata.imageUrl
          }
        };
        continue;
      }

      const metadataLookup = await resolveMetadataLookup(card.name, async (name, mode) => (
        mode === "exact" ? getCardByExactName(name) : getCardByFuzzyName(name)
      )).catch(() => null);

      if (!metadataLookup || !metadataLookup.ok) {
        results[currentIndex] = {
          card,
          failureReason: metadataLookup?.failure.code ?? "lookup_failed"
        };
        continue;
      }

      results[currentIndex] = {
        card,
        metadata: mergeLookupMetadata(card, metadataLookup.lookup)
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, candidates.length)) }, () => worker()));

  let enrichedCount = 0;

  for (const result of results) {
    if (!result) {
      continue;
    }

    if (result.failureReason) {
      failuresByReason[result.failureReason] = (failuresByReason[result.failureReason] ?? 0) + 1;
      continue;
    }

    const nextMetadata = result.metadata;
    const card = result.card;
    if (!nextMetadata) {
      continue;
    }

    const changed = nextMetadata.manaValue !== card.manaValue
      || nextMetadata.type !== card.type
      || nextMetadata.colors !== card.colors
      || nextMetadata.scryfallId !== card.scryfallId
      || nextMetadata.imageSmall !== card.imageSmall
      || nextMetadata.imageNormal !== card.imageNormal
      || nextMetadata.imageUrl !== card.imageUrl;

    if (!changed) {
      continue;
    }

    card.manaValue = nextMetadata.manaValue;
    card.type = nextMetadata.type;
    card.colors = nextMetadata.colors;
    card.scryfallId = nextMetadata.scryfallId;
    card.imageSmall = nextMetadata.imageSmall;
    card.imageNormal = nextMetadata.imageNormal;
    card.imageUrl = nextMetadata.imageUrl;
    enrichedCount += 1;
  }

  return {
    enrichedCount,
    pendingCount: countPendingMetadataCards(cards),
    failuresByReason
  };
}

async function loadDeckWithEnrichment(deckId: number, ownerUserId?: number) {
  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return null;
    }

    const cards = deckCards(database.cards, deckId);
    const enrichment = await opportunisticallyEnrichDeckMetadata(cards, database.cards, deck.commander);
    return { deck, cards, allCards: database.cards, enrichment };
  });
}

function inferTypeForImportedCard(cardName: string) {
  const normalizedName = normalize(cardName);
  const basicLandNames = new Set([
    "plains",
    "island",
    "swamp",
    "mountain",
    "forest",
    "wastes",
    "snow-covered plains",
    "snow-covered island",
    "snow-covered swamp",
    "snow-covered mountain",
    "snow-covered forest",
    "snow-covered wastes"
  ]);
  return basicLandNames.has(normalizedName) ? "Basic Land" : "Unknown";
}

function inferColorsForImportedCard(cardName: string) {
  switch (normalize(cardName)) {
    case "plains":
    case "snow-covered plains":
      return "W";
    case "island":
    case "snow-covered island":
      return "U";
    case "swamp":
    case "snow-covered swamp":
      return "B";
    case "mountain":
    case "snow-covered mountain":
      return "R";
    case "forest":
    case "snow-covered forest":
      return "G";
    default:
      return "Colorless";
  }
}

async function findDeck(deckId: number) {
  const database = await readDatabase();
  return {
    database,
    deck: database.decks.find((entry) => entry.id === deckId),
    cards: deckCards(database.cards, deckId)
  };
}

async function findOwnedDeck(deckId: number, ownerUserId: number) {
  const { database, deck, cards } = await findDeck(deckId);
  const ownedDeck = ensureOwnedResource(deck, ownerUserId, `/api/decks/${deckId}`);
  if ("status" in ownedDeck) {
    return null;
  }

  return { database, deck: ownedDeck, cards };
}

function findExistingCardForImport(deckCardsInDeck: StoredCard[], lookup: CardLookupResult, importedName: string) {
  const normalizedImportedName = normalize(importedName);

  return deckCardsInDeck.find((card) => {
    if (lookup.scryfallId && card.scryfallId && normalize(card.scryfallId) === normalize(lookup.scryfallId)) {
      return true;
    }

    return normalize(card.name) === normalizedImportedName;
  });
}

export function toRouteResponse(result: unknown, status = 200): Response {
  if (result && typeof result === "object" && "status" in result && "body" in result) {
    const routeError = result as ApiRouteError;
    return Response.json(routeError.body, { status: routeError.status });
  }

  if (typeof result === "string") {
    return new Response(result, {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }

  return Response.json(result, { status });
}

export async function getHealthText() {
  return "ok";
}

export async function listDecks(ownerUserId?: number): Promise<Deck[]> {
  const database = await readDatabase();
  const visibleDecks = filterOwnedResources(database.decks, ownerUserId);

  return [...visibleDecks]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((deck) => toDeckListResponse(deck, deckCards(database.cards, deck.id)));
}

export async function createDeck(payload: unknown, path = "/api/decks", ownerUserId?: number): Promise<Deck | ApiRouteError> {
  if (!payload || typeof payload !== "object") {
    return badRequest(path);
  }

  const body = payload as { commander?: unknown; format?: unknown; name?: unknown };
  const name = normalizeNullable(body.name);
  const format = normalizeNullable(body.format);

  if (!name || !format) {
    return badRequest(path);
  }

  const authenticatedOwner = requireAuthenticatedOwner(ownerUserId);
  if (typeof authenticatedOwner !== "number") {
    return authenticatedOwner;
  }

  return withDatabaseWrite(async (database) => {
    const ownerExists = database.users.some((user) => user.id === authenticatedOwner);
    if (!ownerExists) {
      return {
        status: 404,
        body: {
          message: "Deck owner was not found."
        }
      } satisfies ApiRouteError;
    }

    const deck: StoredDeck = createOwnedDeckRecord({
      id: database.nextDeckId++,
      ownerUserId: authenticatedOwner,
      name,
      format,
      commander: normalizeNullable(body.commander) ?? "",
      createdAt: new Date().toISOString()
    });

    database.decks.push(deck);
    initializeDeckValueTracking(database, deck.id, "deck-create");
    return toDeckResponse(deck, []);
  });
}

export async function getDeck(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<Deck | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  return loadedDeck ? await toDeckResponseWithCommanderCover(loadedDeck.deck, loadedDeck.cards, loadedDeck.allCards) : notFound(path);
}

export async function updateDeck(deckId: number, payload: unknown, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<Deck | ApiRouteError> {
  if (!payload || typeof payload !== "object") {
    return badRequest(path);
  }

  const body = payload as { commander?: unknown; format?: unknown; name?: unknown };
  const name = normalizeNullable(body.name);
  const format = normalizeNullable(body.format);

  if (!name || !format) {
    return badRequest(path);
  }

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(path);
    }

    const cards = deckCards(database.cards, deckId);
    const errors = validateCommanderCardTotal({ format }, cards);
    if (errors) {
      return deckValidationError(errors);
    }

    deck.name = name;
    deck.format = format;
    deck.commander = normalizeNullable(body.commander) ?? "";
    return toDeckResponse(deck, cards);
  });
}

export async function listDeckCards(deckId: number, searchParams: URLSearchParams, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<Card[] | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  if (!loadedDeck) {
    return notFound(path);
  }

  let filtered = [...loadedDeck.cards];
  const name = searchParams.get("name");
  const type = searchParams.get("type");
  const color = searchParams.get("color");
  const sortBy = searchParams.get("sortBy");
  const direction = searchParams.get("direction");

  if (name && name.trim()) {
    const search = name.trim().toLowerCase();
    filtered = filtered.filter((card) => normalize(card.name).includes(search));
  }

  if (type && type.trim()) {
    filtered = filtered.filter((card) => normalize(card.type) === type.trim().toLowerCase());
  }

  if (color && color.trim()) {
    filtered = filtered.filter((card) => hasColor(card.colors, color));
  }

  if (sortBy?.toLowerCase() === "name") {
    filtered.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  } else if (sortBy?.toLowerCase() === "manavalue") {
    filtered.sort((left, right) => left.manaValue - right.manaValue);
  }

  if (direction?.toLowerCase() === "desc" && (sortBy?.toLowerCase() === "name" || sortBy?.toLowerCase() === "manavalue")) {
    filtered.reverse();
  }

  return filtered.map(toCardResponse);
}

function parseCardPayload(payload: unknown, path: string): Omit<StoredCard, "deckId" | "id"> | ApiRouteError {
  if (!payload || typeof payload !== "object") {
    return badRequest(path);
  }

  const body = payload as { colors?: unknown; imageNormal?: unknown; imageSmall?: unknown; imageUrl?: unknown; manaValue?: unknown; name?: unknown; quantity?: unknown; scryfallId?: unknown; type?: unknown };
  const name = normalizeNullable(body.name);
  const type = normalizeNullable(body.type);
  const colors = normalizeNullable(body.colors);
  const manaValue = typeof body.manaValue === "number" ? Math.trunc(body.manaValue) : Number.NaN;
  const quantityValue = typeof body.quantity === "number" ? Math.trunc(body.quantity) : Number.NaN;

  if (!name || !type || !colors || Number.isNaN(manaValue) || manaValue < 0 || Number.isNaN(quantityValue) || quantityValue < 1) {
    return badRequest(path);
  }

  return {
    name,
    manaValue,
    type,
    colors,
    quantity: quantityValue,
    scryfallId: normalizeNullable(body.scryfallId),
    imageSmall: normalizeNullable(body.imageSmall),
    imageNormal: normalizeNullable(body.imageNormal),
    imageUrl: normalizeNullable(body.imageUrl)
  };
}

export async function addDeckCard(deckId: number, payload: unknown, path = `/api/decks/${deckId}/cards`, ownerUserId?: number): Promise<Card | ApiRouteError> {
  const parsed = parseCardPayload(payload, path);
  if ("status" in parsed) {
    return parsed;
  }

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(`/api/decks/${deckId}`);
    }

    const errors = validateCommanderCardTotal(deck, [...deckCards(database.cards, deckId), { quantity: parsed.quantity }]);
    if (errors) {
      return deckValidationError(errors);
    }

    const metadata = reuseStoredCardMetadata(
      await resolveCardMetadata(parsed.name, parsed),
      database.cards,
      { excludeDeckId: deckId }
    );
    const card: StoredCard = {
      ...metadata,
      deckId,
      id: database.nextCardId++
    };

    database.cards.push(card);
    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "card-add",
        replaceEmptyBaseline: !database.cards.some((entry) => entry.deckId === deckId && entry.id !== card.id)
      });
    } catch {
      // Pricing refresh must not block card creation.
    }
    return toCardResponse(card);
  });
}

export async function updateDeckCard(deckId: number, cardId: number, payload: unknown, path = `/api/decks/${deckId}/cards/${cardId}`, ownerUserId?: number): Promise<Card | ApiRouteError> {
  const parsed = parseCardPayload(payload, path);
  if ("status" in parsed) {
    return parsed;
  }

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(`/api/decks/${deckId}`);
    }

    const card = database.cards.find((entry) => entry.deckId === deckId && entry.id === cardId);
    if (!card) {
      return notFound(path);
    }

    const errors = validateCommanderCardTotal(deck, [...deckCards(database.cards, deckId).filter((entry) => entry.id !== cardId), { quantity: parsed.quantity }]);
    if (errors) {
      return deckValidationError(errors);
    }

    Object.assign(
      card,
      reuseStoredCardMetadata(
        await resolveCardMetadata(parsed.name, parsed),
        database.cards,
        { excludeDeckId: deckId, excludeCardIds: [card.id] }
      )
    );
    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "card-update"
      });
    } catch {
      // Pricing refresh must not block card updates.
    }
    return toCardResponse(card);
  });
}

export async function deleteDeckCard(deckId: number, cardId: number, path = `/api/decks/${deckId}/cards/${cardId}`, ownerUserId?: number): Promise<null | ApiRouteError> {
  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(path);
    }

    const index = database.cards.findIndex((entry) => entry.deckId === deckId && entry.id === cardId);
    if (index < 0) {
      return notFound(path);
    }

    database.cards.splice(index, 1);
    database.cardValueSnapshots = database.cardValueSnapshots.map((snapshot) => (
      snapshot.cardId === cardId
        ? {
            ...snapshot,
            cardId: null
          }
        : snapshot
    ));
    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "card-delete"
      });
    } catch {
      // Pricing refresh must not block card deletions.
    }
    return null;
  });
}

export async function getDeckStats(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<DeckStats | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  if (!loadedDeck) {
    return notFound(path);
  }

  const { cards } = loadedDeck;
  const byColor: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const manaCurve: Record<string, number> = {};
  let totalCards = 0;

  for (const card of cards) {
    totalCards += quantity(card);
    byType[card.type] = (byType[card.type] ?? 0) + quantity(card);
    manaCurve[String(card.manaValue)] = (manaCurve[String(card.manaValue)] ?? 0) + quantity(card);
    const colors = splitColors(card.colors);
    if (colors.length === 0) {
      byColor.Colorless = (byColor.Colorless ?? 0) + quantity(card);
    } else {
      for (const color of colors) {
        byColor[color] = (byColor[color] ?? 0) + quantity(card);
      }
    }
  }

  return { totalCards, byColor, byType, manaCurve };
}

export async function getDeckPassport(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number) {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  return loadedDeck ? buildDeckPassport(loadedDeck.deck, loadedDeck.cards) : notFound(path);
}

export async function getMulliganSample(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number) {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  return loadedDeck ? buildMulliganSample(loadedDeck.cards) : notFound(path);
}

export async function exportDecklist(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<string | ApiRouteError> {
  if (ownerUserId != null) {
    const ownedDeck = await findOwnedDeck(deckId, ownerUserId);
    if (!ownedDeck) {
      return notFound(path);
    }

    const commanderName = firstNonBlank(ownedDeck.deck.commander);
    const bodyLines = ownedDeck.cards
      .filter((card) => normalize(card.name) !== normalize(commanderName))
      .map((card) => `${card.quantity} ${card.name}`);

    if (isCommanderDeck(ownedDeck.deck.format) && commanderName) {
      return ["Commander", `1 ${commanderName}`, "", "Deck", ...bodyLines].join("\n");
    }

    return ownedDeck.cards.map((card) => `${card.quantity} ${card.name}`).join("\n");
  }

  const { deck, cards } = await findDeck(deckId);
  if (!deck) {
    return notFound(path);
  }

  const commanderName = firstNonBlank(deck.commander);
  const bodyLines = cards
    .filter((card) => normalize(card.name) !== normalize(commanderName))
    .map((card) => `${card.quantity} ${card.name}`);

  if (isCommanderDeck(deck.format) && commanderName) {
    return ["Commander", `1 ${commanderName}`, "", "Deck", ...bodyLines].join("\n");
  }

  return cards.map((card) => `${card.quantity} ${card.name}`).join("\n");
}

export async function importDecklist(deckId: number, payload: unknown, path = `/api/decks/${deckId}/import`, ownerUserId?: number): Promise<ImportResult | ApiRouteError> {
  if (!payload || typeof payload !== "object" || !normalizeNullable((payload as { decklistText?: unknown }).decklistText)) {
    return badRequest(path);
  }

  const decklistText = normalizeNullable((payload as { decklistText?: unknown }).decklistText) ?? "";

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(`/api/decks/${deckId}`);
    }

    const cardsInDeck = deckCards(database.cards, deckId);
    const wasDeckEmptyBeforeImport = cardsInDeck.length === 0;
    const metadataEnrichment = await opportunisticallyEnrichDeckMetadata(cardsInDeck, database.cards, deck.commander);

    const preview = parseDecklistText(decklistText);
    const errors: ImportResult["errors"] = [...preview.unrecognizedLines];
    const importableCards: Array<{
      lookup: CardLookupResult | null;
      name: string;
      quantity: number;
      resolvedBy: "exact" | "normalized-exact" | "fuzzy" | "fallback-inferred";
      fallbackFailure?: { code: string; status: number; message: string } | undefined;
    }> = [];
    let unresolvedLookupLines = 0;
    let normalizedExactLookups = 0;
    let fuzzyLookups = 0;
    let fallbackImportedCards = 0;
    const lookupFailuresByReason: Record<string, number> = {};
    const resolvedEntries = await resolveImportEntriesWithFallback(
      preview.recognizedEntries,
      async (name, mode) => (mode === "exact" ? getCardByExactName(name) : getCardByFuzzyName(name))
    );

    for (const resolvedEntry of resolvedEntries) {
      if (resolvedEntry.ok) {
        if (resolvedEntry.resolvedBy === "normalized-exact") {
          normalizedExactLookups += 1;
        } else if (resolvedEntry.resolvedBy === "fuzzy") {
          fuzzyLookups += 1;
        } else if (resolvedEntry.resolvedBy === "fallback-inferred") {
          fallbackImportedCards += resolvedEntry.entry.quantity;
          const reason = resolvedEntry.failure?.code ?? "lookup_failed";
          lookupFailuresByReason[reason] = (lookupFailuresByReason[reason] ?? 0) + resolvedEntry.entry.lineNumbers.length;
        }

        importableCards.push({
          lookup: resolvedEntry.lookup ?? null,
          name: resolvedEntry.entry.name,
          quantity: resolvedEntry.entry.quantity,
          resolvedBy: resolvedEntry.resolvedBy,
          fallbackFailure: resolvedEntry.failure
        });
        continue;
      }

      for (let index = 0; index < resolvedEntry.entry.lineNumbers.length; index += 1) {
        unresolvedLookupLines += 1;
        const reason = resolvedEntry.failure.code ?? "lookup_failed";
        lookupFailuresByReason[reason] = (lookupFailuresByReason[reason] ?? 0) + 1;
        errors.push({
          kind: "lookup",
          line: resolvedEntry.entry.lineNumbers[index] ?? 0,
          message: resolvedEntry.failure.message,
          rawLine: resolvedEntry.entry.rawLines[index] ?? resolvedEntry.entry.name,
          lookupCode: resolvedEntry.failure.code,
          lookupStatus: resolvedEntry.failure.status
        });
      }
    }

    const commanderErrors = validateCommanderCardTotal(deck, [...deckCards(database.cards, deckId), ...importableCards.map((card) => ({ quantity: card.quantity }))]);
    if (commanderErrors) {
      return deckValidationError(commanderErrors);
    }

    const createdCards: ImportResult["createdCards"] = [];
    const updatedCards: ImportResult["updatedCards"] = [];
    let importedCount = 0;

    for (const parsedCard of importableCards) {
      const resolvedLookup = parsedCard.lookup;
      const importedName = resolvedLookup?.name ?? parsedCard.name;
      const existingCard = resolvedLookup ? findExistingCardForImport(cardsInDeck, resolvedLookup, parsedCard.name) : cardsInDeck.find((card) => normalize(card.name) === normalize(parsedCard.name)) ?? null;
      const metadata = {
        scryfallId: normalizeNullable(resolvedLookup?.scryfallId),
        imageSmall: normalizeNullable(resolvedLookup?.imageSmall),
        imageNormal: normalizeNullable(resolvedLookup?.imageNormal),
        imageUrl: firstNonBlank(resolvedLookup?.imageNormal, resolvedLookup?.imageSmall)
      };
      const nextType = resolvedLookup?.type || inferTypeForImportedCard(importedName);
      const nextColors = resolvedLookup?.colors || inferColorsForImportedCard(importedName);
      const nextManaValue = resolvedLookup?.manaValue ?? 0;
      const reusedMetadata = reuseStoredCardMetadata(
        {
          name: importedName,
          manaValue: nextManaValue,
          type: nextType,
          colors: nextColors,
          quantity: parsedCard.quantity,
          scryfallId: metadata.scryfallId,
          imageSmall: metadata.imageSmall,
          imageNormal: metadata.imageNormal,
          imageUrl: metadata.imageUrl
        },
        database.cards,
        {
          excludeDeckId: deckId
        }
      );

      if (existingCard) {
        existingCard.name = importedName;
        existingCard.manaValue = reusedMetadata.manaValue;
        existingCard.type = reusedMetadata.type;
        existingCard.colors = reusedMetadata.colors;
        existingCard.quantity += parsedCard.quantity;
        existingCard.scryfallId = reusedMetadata.scryfallId;
        existingCard.imageSmall = reusedMetadata.imageSmall;
        existingCard.imageNormal = reusedMetadata.imageNormal;
        existingCard.imageUrl = reusedMetadata.imageUrl;
        importedCount += parsedCard.quantity;
        updatedCards.push({ id: existingCard.id, name: existingCard.name, quantity: existingCard.quantity });
        continue;
      }

      const card: StoredCard = {
        id: database.nextCardId++,
        deckId,
        name: importedName,
        manaValue: reusedMetadata.manaValue,
        type: reusedMetadata.type,
        colors: reusedMetadata.colors,
        quantity: parsedCard.quantity,
        scryfallId: reusedMetadata.scryfallId,
        imageSmall: reusedMetadata.imageSmall,
        imageNormal: reusedMetadata.imageNormal,
        imageUrl: reusedMetadata.imageUrl
      };

      database.cards.push(card);
      cardsInDeck.push(card);
      importedCount += parsedCard.quantity;
      createdCards.push({ id: card.id, name: card.name, quantity: card.quantity });
    }

    const importedCommanderInference = inferCommanderFromResolvedEntries(
      deck.format,
      preview.commanderEntries,
      importableCards.map((card) => ({
        name: card.lookup?.name ?? card.name,
        originalName: card.name,
        quantity: card.quantity,
        type: card.lookup?.type ?? inferTypeForImportedCard(card.name)
      }))
    );
    const inferredCommander = inferCommanderFromCards(deck, cardsInDeck);
    const nextCommanderName = firstNonBlank(deck.commander, importedCommanderInference.commanderName, inferredCommander);
    const commanderDetection = !isCommanderDeck(deck.format)
      ? "No aplica a este formato."
      : (deck.commander
          ? "Se mantiene el comandante ya guardado."
          : importedCommanderInference.commanderName
            ? importedCommanderInference.detection
            : inferredCommander
                ? "Comandante inferido desde la lista importada."
                : "Sin comandante fiable; la portada usa el primer arte disponible como fallback.");

    if (isCommanderDeck(deck.format) && nextCommanderName) {
      deck.commander = nextCommanderName;
    }

    const metadataPendingCards = countPendingMetadataCards(cardsInDeck);

    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "deck-import",
        replaceEmptyBaseline: wasDeckEmptyBeforeImport
      });
    } catch {
      // Import success should not be reverted by a pricing refresh failure.
    }

    return {
      importedCount,
      createdCards,
      updatedCards,
      errors,
      pipeline: {
        detectedSource: preview.detectedSourceLabel,
        totalPastedLines: preview.totalPastedLines,
        ignoredBlankLines: preview.ignoredBlankLines,
        ignoredSectionLines: preview.ignoredSectionLines,
        ignoredLines: preview.ignoredBlankLines + preview.ignoredSectionLines,
        parsedLines: preview.parsedLines,
        recognizedCards: importableCards.length,
        unresolvedLines: errors.length,
        parseFailures: preview.unrecognizedLines.length,
        unresolvedCardLookups: unresolvedLookupLines,
        normalizedExactLookups,
        fuzzyLookups,
        fallbackImportedCards,
        metadataEnrichedCards: metadataEnrichment.enrichedCount,
        metadataPendingCards,
        lookupFailuresByReason,
        metadataEnrichmentFailuresByReason: metadataEnrichment.failuresByReason,
        duplicatesConsolidated: preview.duplicatesConsolidated,
        actuallyImportedCards: importedCount,
        skippedOrFailedImports: errors.length,
        commanderDetection
      }
    };
  });
}

export async function searchCards(query: string, limit: number): Promise<CardLookupResult[]> {
  return searchScryfallCards(query, limit);
}

export async function getDeckValue(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<DeckValueTracker | ApiRouteError> {
  const ownedDeck = ownerUserId != null ? await findOwnedDeck(deckId, ownerUserId) : await findDeck(deckId);
  if (!ownedDeck?.deck) {
    return notFound(path);
  }

  const tracker = await ensureDeckValueTracker(deckId);
  return tracker ?? notFound(path);
}

export async function getDeckPortfolio(ownerUserId: number): Promise<DeckPortfolio> {
  return ensurePortfolioValueTracker(ownerUserId);
}
