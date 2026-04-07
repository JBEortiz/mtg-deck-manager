import "server-only";

import type {
  BuyOpportunityFilters,
  BuyOpportunityItem,
  BuyOpportunities,
  BuyOpportunitySort,
  CollectorOverview,
  CollectorOverviewFilters,
  CollectorOverviewItem,
  CollectorOverviewPriceDataFilter,
  CollectorOverviewProfitability,
  CollectorOverviewPurchase,
  CollectorOverviewSort,
  CardDetail,
  CardDetailDeckUsage,
  DeckWishlist,
  DeckWishlistCostBasis,
  DeckWishlistConfidence,
  DeckWishlistHistory,
  DeckWishlistHistoryStatus,
  DeckWishlistItem,
  DeckWishlistPricePoint,
  DeckWishlistPurchase,
  DeckWishlistRefreshResult,
  DeckWishlistSignal,
  DeckWishlistSort
} from "@/lib/types";
import {
  readDatabase,
  type DatabaseShape,
  type StoredDeckCardPurchase,
  type StoredWishlistItem,
  type StoredWishlistPricePoint,
  withDatabaseWrite
} from "@/lib/server/mtg-store";
import { getCardByExactName, getCardByFuzzyName, getCardPricesByCollection, ScryfallRouteError } from "@/lib/scryfall/server";

export type WishlistRouteError = {
  body: Record<string, unknown>;
  status: number;
};

const DEFAULT_CURRENCY = "USD";
const BUY_SIGNAL_THRESHOLD_PERCENT = 8;
const REF_PRICE_POINT_WINDOW = 5;
const REF_PRICE_MIN_POINTS = 2;
const HISTORY_POINT_LIMIT = 30;
const PRICE_REFRESH_TTL_MS = 1000 * 60 * 60 * 12;
const PRICE_REFRESH_DIAGNOSTIC_SAMPLE_LIMIT = 8;
const PURCHASE_MAX_QUANTITY = 999;
const PURCHASE_MAX_UNIT_PRICE_USD = 100000;
const DEFAULT_OPPORTUNITIES_FILTERS: BuyOpportunityFilters = {
  signal: "all",
  deckId: "all",
  historyStatus: "all"
};
const DEFAULT_COLLECTOR_FILTERS: CollectorOverviewFilters = {
  deckId: "all",
  profitability: "all",
  priceData: "all"
};

type CardIdentityInput = {
  mode: "identity-key" | "scryfall-id" | "card-name";
  value: string;
};

function normalize(value: string | null | undefined) {
  return value == null ? "" : value.trim().toLowerCase();
}

function normalizeNullable(value: unknown): string | null {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function springErrorBody(status: number, error: string, path: string) {
  return {
    timestamp: new Date().toISOString(),
    status,
    error,
    path
  };
}

function notFound(path: string): WishlistRouteError {
  return {
    status: 404,
    body: springErrorBody(404, "Not Found", path)
  };
}

function badRequest(path: string, message = "Validation failed", errors: string[] = []): WishlistRouteError {
  return {
    status: 400,
    body: {
      message,
      errors
    }
  };
}

function nowIso() {
  return new Date().toISOString();
}

function toDay(isoDateTime: string) {
  return isoDateTime.slice(0, 10);
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function resolvedIdentityKey(cardName: string, scryfallId: string | null | undefined) {
  const normalizedScryfallId = normalize(scryfallId);
  if (normalizedScryfallId) {
    return `id:${normalizedScryfallId}`;
  }

  return `name:${normalize(cardName)}`;
}

function identityAliasKeys(cardName: string, scryfallId: string | null | undefined, identityKey: string | null | undefined) {
  const keys = new Set<string>();
  const normalizedIdentityKey = normalize(identityKey);
  const normalizedScryfall = normalize(scryfallId);
  const normalizedName = normalize(cardName);

  if (normalizedIdentityKey) {
    keys.add(normalizedIdentityKey);
  }
  if (normalizedScryfall) {
    keys.add(`id:${normalizedScryfall}`);
  }
  if (normalizedName) {
    keys.add(`name:${normalizedName}`);
  }

  return keys;
}

function pointMatchesIdentity(
  point: StoredWishlistPricePoint,
  aliases: Set<string>,
  normalizedScryfall: string,
  normalizedName: string
) {
  if (aliases.has(normalize(point.resolvedIdentityKey))) {
    return true;
  }

  if (normalizedScryfall && normalize(point.scryfallId) === normalizedScryfall) {
    return true;
  }

  if (normalizedName && normalize(point.cardName) === normalizedName) {
    return true;
  }

  return false;
}

function pricingCoverageState(
  item: { cardName: string; scryfallId: string | null },
  points: DeckWishlistPricePoint[]
): {
  state: "ready" | "limited" | "missing";
  reason: string;
} {
  if (points.length >= REF_PRICE_MIN_POINTS) {
    return {
      state: "ready",
      reason: "Hay suficiente historial local para mostrar precio y referencia."
    };
  }

  if (points.length === 1) {
    return {
      state: "limited",
      reason: "Solo hay un dato local reciente; la lectura es orientativa."
    };
  }

  if (!normalize(item.scryfallId)) {
    return {
      state: "missing",
      reason: "Carta sin identificador confirmado; intenta refrescar o ajustar el nombre."
    };
  }

  return {
    state: "missing",
    reason: "Todavia no hay datos de precio en cache local para esta carta."
  };
}

function pricingComparisonReason(input: {
  currentPriceUsd: number | null;
  referencePriceUsd: number | null;
  points: DeckWishlistPricePoint[];
}) {
  if (input.currentPriceUsd == null) {
    return "Sin precio actual local para comparar.";
  }

  if (input.referencePriceUsd != null) {
    return null;
  }

  if (input.points.length === 0) {
    return "Sin historial local para calcular referencia.";
  }

  if (input.points.length < REF_PRICE_MIN_POINTS) {
    return "Historial corto: falta base minima para comparar.";
  }

  return "No hay referencia comparable disponible.";
}

function deckOwned(database: DatabaseShape, deckId: number, ownerUserId?: number) {
  return database.decks.find((entry) => entry.id === deckId && (ownerUserId == null || entry.ownerUserId === ownerUserId)) ?? null;
}

function signalForDeltaPercent(deltaPercent: number | null): DeckWishlistSignal {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) {
    return "normal";
  }

  if (deltaPercent <= -BUY_SIGNAL_THRESHOLD_PERCENT) {
    return "good-moment";
  }

  if (deltaPercent >= BUY_SIGNAL_THRESHOLD_PERCENT) {
    return "expensive-now";
  }

  return "normal";
}

function buildHistoryPoints(database: DatabaseShape, deckId: number, item: StoredWishlistItem): DeckWishlistPricePoint[] {
  const points: DeckWishlistPricePoint[] = [];
  const cardId = normalize(item.scryfallId);
  const cardName = normalize(item.cardName);
  const aliases = identityAliasKeys(item.cardName, item.scryfallId, item.resolvedIdentityKey);
  const snapshotById = new Map(database.deckValueSnapshots.map((snapshot) => [snapshot.id, snapshot]));

  for (const point of database.wishlistPriceHistory) {
    if (!pointMatchesIdentity(point, aliases, cardId, cardName)) {
      continue;
    }

    points.push({
      capturedAt: point.capturedAt,
      priceUsd: round2(point.priceUsd),
      source: "cache"
    });
  }

  for (const snapshot of database.cardValueSnapshots) {
    if (snapshot.deckId !== deckId || snapshot.unitPrice == null) {
      continue;
    }

    const matchesById = Boolean(cardId) && normalize(snapshot.scryfallId) === cardId;
    const matchesByName = normalize(snapshot.cardName) === cardName;
    if (!matchesById && !matchesByName) {
      continue;
    }

    const deckSnapshot = snapshotById.get(snapshot.deckSnapshotId);
    if (!deckSnapshot) {
      continue;
    }

    points.push({
      capturedAt: deckSnapshot.snapshotAt,
      priceUsd: round2(snapshot.unitPrice),
      source: "deck-snapshot"
    });
  }

  const deduped = new Map<string, DeckWishlistPricePoint>();
  for (const point of points) {
    const key = `${point.capturedAt}:${point.priceUsd.toFixed(2)}`;
    if (!deduped.has(key)) {
      deduped.set(key, point);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime())
    .slice(0, HISTORY_POINT_LIMIT);
}

function historyStatus(points: DeckWishlistPricePoint[]): "available" | "limited" | "unavailable" {
  if (points.length === 0) {
    return "unavailable";
  }

  if (points.length < REF_PRICE_MIN_POINTS) {
    return "limited";
  }

  return "available";
}

function confidence(item: StoredWishlistItem, points: DeckWishlistPricePoint[]): "full" | "limited" {
  return item.scryfallId && points.length >= REF_PRICE_MIN_POINTS ? "full" : "limited";
}

function toWishlistPurchaseResponse(purchase: StoredDeckCardPurchase): DeckWishlistPurchase {
  return {
    id: purchase.id,
    ownerUserId: purchase.ownerUserId,
    deckId: purchase.deckId,
    wishlistItemId: purchase.wishlistItemId,
    resolvedIdentityKey: purchase.resolvedIdentityKey,
    cardName: purchase.cardName,
    scryfallId: purchase.scryfallId,
    quantity: purchase.quantity,
    unitPriceUsd: round2(purchase.unitPriceUsd),
    purchasedAt: purchase.purchasedAt,
    createdAt: purchase.createdAt
  };
}

function toWishlistCostBasis(purchases: StoredDeckCardPurchase[], currentPriceUsd: number | null): DeckWishlistCostBasis {
  if (purchases.length === 0) {
    return {
      totalPurchasedQuantity: 0,
      averageCostBasisUsd: null,
      totalCostBasisUsd: null,
      currentValueUsd: null,
      deltaUsd: null,
      deltaPercent: null
    };
  }

  const totalPurchasedQuantity = purchases.reduce((sum, purchase) => sum + purchase.quantity, 0);
  const totalCostBasisUsd = round2(purchases.reduce((sum, purchase) => sum + (purchase.quantity * purchase.unitPriceUsd), 0));
  const averageCostBasisUsd = totalPurchasedQuantity > 0 ? round2(totalCostBasisUsd / totalPurchasedQuantity) : null;
  const currentValueUsd = currentPriceUsd == null ? null : round2(currentPriceUsd * totalPurchasedQuantity);
  const deltaUsd = currentValueUsd == null ? null : round2(currentValueUsd - totalCostBasisUsd);
  const deltaPercent = averageCostBasisUsd != null && currentPriceUsd != null && averageCostBasisUsd > 0
    ? round2(((currentPriceUsd - averageCostBasisUsd) / averageCostBasisUsd) * 100)
    : null;

  return {
    totalPurchasedQuantity,
    averageCostBasisUsd,
    totalCostBasisUsd,
    currentValueUsd,
    deltaUsd,
    deltaPercent
  };
}

function toWishlistItemResponse(database: DatabaseShape, deckId: number, item: StoredWishlistItem): DeckWishlistItem {
  const points = buildHistoryPoints(database, deckId, item);
  const currentPriceUsd = points.length > 0 ? points[0]?.priceUsd ?? null : null;
  const referencePoints = points.slice(0, REF_PRICE_POINT_WINDOW);
  const referencePriceUsd = referencePoints.length >= REF_PRICE_MIN_POINTS
    ? round2(referencePoints.reduce((sum, point) => sum + point.priceUsd, 0) / referencePoints.length)
    : null;
  const deltaUsd = currentPriceUsd != null && referencePriceUsd != null ? round2(currentPriceUsd - referencePriceUsd) : null;
  const deltaPercent = deltaUsd != null && referencePriceUsd != null && referencePriceUsd > 0
    ? round2((deltaUsd / referencePriceUsd) * 100)
    : null;
  const coverage = pricingCoverageState(item, points);
  const comparisonReason = pricingComparisonReason({
    currentPriceUsd,
    referencePriceUsd,
    points
  });

  const itemPurchases = database.deckCardPurchases
    .filter((purchase) => purchase.deckId === deckId && purchase.resolvedIdentityKey === item.resolvedIdentityKey)
    .sort((left, right) => new Date(right.purchasedAt).getTime() - new Date(left.purchasedAt).getTime() || right.id - left.id);

  return {
    id: item.id,
    ownerUserId: item.ownerUserId,
    deckId: item.deckId,
    cardName: item.cardName,
    scryfallId: item.scryfallId,
    resolvedIdentityKey: item.resolvedIdentityKey,
    targetQuantity: item.targetQuantity,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pricing: {
      currentPriceUsd,
      referencePriceUsd,
      deltaUsd,
      deltaPercent,
      signal: signalForDeltaPercent(deltaPercent),
      confidence: confidence(item, points),
      historyStatus: historyStatus(points),
      lastCapturedAt: points[0]?.capturedAt ?? null,
      coverageState: coverage.state,
      coverageReason: coverage.reason,
      comparisonReason
    },
    purchases: itemPurchases.map(toWishlistPurchaseResponse),
    costBasis: toWishlistCostBasis(itemPurchases, currentPriceUsd)
  };
}

function sortWishlistItems(items: DeckWishlistItem[], sort: DeckWishlistSort) {
  if (sort === "name") {
    return [...items].sort((left, right) => left.cardName.localeCompare(right.cardName) || left.id - right.id);
  }

  if (sort === "newest") {
    return [...items].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || right.id - left.id);
  }

  const signalRank: Record<DeckWishlistSignal, number> = {
    "good-moment": 0,
    normal: 1,
    "expensive-now": 2
  };

  return [...items].sort((left, right) => {
    const signalDiff = signalRank[left.pricing.signal] - signalRank[right.pricing.signal];
    if (signalDiff !== 0) {
      return signalDiff;
    }

    const confidenceDiff = (left.pricing.confidence === "full" ? 0 : 1) - (right.pricing.confidence === "full" ? 0 : 1);
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }

    const leftDelta = left.pricing.deltaPercent ?? Number.POSITIVE_INFINITY;
    const rightDelta = right.pricing.deltaPercent ?? Number.POSITIVE_INFINITY;
    if (leftDelta !== rightDelta) {
      return leftDelta - rightDelta;
    }

    const nameDiff = left.cardName.localeCompare(right.cardName);
    if (nameDiff !== 0) {
      return nameDiff;
    }

    const createdDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return left.id - right.id;
  });
}

function parseWishlistSort(value: string | null): DeckWishlistSort {
  const normalized = normalize(value);
  if (normalized === "name") {
    return "name";
  }
  if (normalized === "newest") {
    return "newest";
  }
  return "best-opportunity";
}

function parseOpportunitiesSort(value: string | null): BuyOpportunitySort {
  const normalized = normalize(value);
  if (normalized === "highest-discount") {
    return "highest-discount";
  }
  if (normalized === "card-name") {
    return "card-name";
  }
  if (normalized === "deck-name") {
    return "deck-name";
  }
  if (normalized === "current-price") {
    return "current-price";
  }
  return "best-opportunity";
}

function parseOpportunitiesFilters(raw: {
  signal?: string | null;
  deckId?: string | number | null;
  historyStatus?: string | null;
}): BuyOpportunityFilters {
  const signal = normalize(raw.signal);
  const historyStatus = normalize(raw.historyStatus);

  const parsedDeckId = typeof raw.deckId === "number"
    ? Math.trunc(raw.deckId)
    : Number.parseInt(typeof raw.deckId === "string" ? raw.deckId : "", 10);

  return {
    signal: signal === "good-moment" || signal === "normal" || signal === "expensive-now"
      ? signal
      : "all",
    deckId: Number.isFinite(parsedDeckId) && parsedDeckId > 0 ? parsedDeckId : "all",
    historyStatus: historyStatus === "available" || historyStatus === "limited" || historyStatus === "unavailable"
      ? historyStatus
      : "all"
  };
}

function parseCollectorSort(value: string | null): CollectorOverviewSort {
  const normalized = normalize(value);
  if (normalized === "biggest-gain") {
    return "biggest-gain";
  }
  if (normalized === "biggest-loss") {
    return "biggest-loss";
  }
  if (normalized === "total-value") {
    return "total-value";
  }
  if (normalized === "total-cost") {
    return "total-cost";
  }
  if (normalized === "card-name") {
    return "card-name";
  }
  return "latest-purchase";
}

function parseCollectorFilters(raw: {
  deckId?: string | number | null;
  profitability?: string | null;
  priceData?: string | null;
}): CollectorOverviewFilters {
  const parsedDeckId = typeof raw.deckId === "number"
    ? Math.trunc(raw.deckId)
    : Number.parseInt(typeof raw.deckId === "string" ? raw.deckId : "", 10);

  const profitability = normalize(raw.profitability) as CollectorOverviewProfitability;
  const priceData = normalize(raw.priceData) as CollectorOverviewPriceDataFilter;

  return {
    deckId: Number.isFinite(parsedDeckId) && parsedDeckId > 0 ? parsedDeckId : "all",
    profitability: profitability === "profitable" || profitability === "unprofitable" || profitability === "flat"
      ? profitability
      : DEFAULT_COLLECTOR_FILTERS.profitability,
    priceData: priceData === "limited-or-unavailable"
      ? priceData
      : DEFAULT_COLLECTOR_FILTERS.priceData
  };
}

function parseCardIdentityInput(rawIdentity: string): CardIdentityInput | null {
  let decoded = "";
  try {
    decoded = decodeURIComponent(rawIdentity ?? "").trim();
  } catch {
    decoded = (rawIdentity ?? "").trim();
  }
  if (!decoded) {
    return null;
  }

  const normalized = normalize(decoded);
  if (normalized.startsWith("id:")) {
    const idValue = decoded.slice(decoded.indexOf(":") + 1).trim();
    return idValue ? { mode: "scryfall-id", value: idValue } : null;
  }

  if (normalized.startsWith("name:")) {
    const nameValue = decoded.slice(decoded.indexOf(":") + 1).trim();
    return nameValue ? { mode: "card-name", value: nameValue } : null;
  }

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidLike.test(decoded)) {
    return { mode: "scryfall-id", value: decoded };
  }

  if (normalized.startsWith("id%3a") || normalized.startsWith("name%3a")) {
    return parseCardIdentityInput(decoded);
  }

  if (normalized.startsWith("id:") || normalized.startsWith("name:")) {
    return { mode: "identity-key", value: decoded };
  }

  return { mode: "card-name", value: decoded };
}

function matchesIdentity(
  target: CardIdentityInput,
  cardName: string,
  scryfallId: string | null | undefined,
  identityKey: string
) {
  if (target.mode === "scryfall-id") {
    return normalize(scryfallId) === normalize(target.value);
  }

  if (target.mode === "card-name") {
    return normalize(cardName) === normalize(target.value);
  }

  return normalize(identityKey) === normalize(target.value);
}

function pickDisplayCardName(candidates: string[], fallback: string) {
  const normalizedFallback = fallback.trim() || "Carta";
  if (candidates.length === 0) {
    return normalizedFallback;
  }

  const frequency = new Map<string, number>();
  for (const value of candidates) {
    const key = value.trim();
    if (!key) {
      continue;
    }
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }

  if (frequency.size === 0) {
    return normalizedFallback;
  }

  return [...frequency.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
    ?? normalizedFallback;
}

function buildDeckUsageRows(
  ownerDecks: Array<{ id: number; name: string }>,
  cardsByDeck: Map<number, { quantity: number }[]>,
  wishlistByDeck: Map<number, { id: number; targetQuantity: number }[]>
) {
  const rows: CardDetailDeckUsage[] = [];

  for (const deck of ownerDecks) {
    const cards = cardsByDeck.get(deck.id) ?? [];
    const wishlist = wishlistByDeck.get(deck.id) ?? [];
    const quantity = cards.reduce((sum, card) => sum + card.quantity, 0);
    const firstWishlist = wishlist[0] ?? null;

    if (quantity <= 0 && !firstWishlist) {
      continue;
    }

    rows.push({
      deckId: deck.id,
      deckName: deck.name,
      quantity,
      inDeck: quantity > 0,
      wishlistItemId: firstWishlist?.id ?? null,
      wishlistTargetQuantity: firstWishlist?.targetQuantity ?? null
    });
  }

  return rows.sort((left, right) => left.deckName.localeCompare(right.deckName) || left.deckId - right.deckId);
}

function buildOwnedIdentityHistoryPoints(
  database: DatabaseShape,
  ownedDeckIdSet: Set<number>,
  resolvedIdentity: string,
  scryfallId: string | null,
  cardName: string
) {
  const points: DeckWishlistPricePoint[] = [];
  const normalizedScryfall = normalize(scryfallId);
  const normalizedName = normalize(cardName);
  const aliases = identityAliasKeys(cardName, scryfallId, resolvedIdentity);
  const snapshotById = new Map(database.deckValueSnapshots.map((snapshot) => [snapshot.id, snapshot]));

  for (const point of database.wishlistPriceHistory) {
    if (!pointMatchesIdentity(point, aliases, normalizedScryfall, normalizedName)) {
      continue;
    }

    points.push({
      capturedAt: point.capturedAt,
      priceUsd: round2(point.priceUsd),
      source: "cache"
    });
  }

  for (const snapshot of database.cardValueSnapshots) {
    if (!ownedDeckIdSet.has(snapshot.deckId) || snapshot.unitPrice == null) {
      continue;
    }

    const matchesById = Boolean(normalizedScryfall) && normalize(snapshot.scryfallId) === normalizedScryfall;
    const matchesByName = normalize(snapshot.cardName) === normalizedName;
    if (!matchesById && !matchesByName) {
      continue;
    }

    const deckSnapshot = snapshotById.get(snapshot.deckSnapshotId);
    if (!deckSnapshot) {
      continue;
    }

    points.push({
      capturedAt: deckSnapshot.snapshotAt,
      priceUsd: round2(snapshot.unitPrice),
      source: "deck-snapshot"
    });
  }

  const deduped = new Map<string, DeckWishlistPricePoint>();
  for (const point of points) {
    const key = `${point.capturedAt}:${point.priceUsd.toFixed(2)}`;
    if (!deduped.has(key)) {
      deduped.set(key, point);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime())
    .slice(0, HISTORY_POINT_LIMIT);
}

function collectorProfitabilityState(item: CollectorOverviewItem): CollectorOverviewProfitability {
  if (item.deltaUsd == null || item.deltaUsd === 0) {
    return "flat";
  }
  return item.deltaUsd > 0 ? "profitable" : "unprofitable";
}

function sortCollectorItems(items: CollectorOverviewItem[], sort: CollectorOverviewSort) {
  const byCard = (left: CollectorOverviewItem, right: CollectorOverviewItem) => (
    left.cardName.localeCompare(right.cardName)
    || left.resolvedIdentityKey.localeCompare(right.resolvedIdentityKey)
  );

  const byLatestPurchaseDesc = (left: CollectorOverviewItem, right: CollectorOverviewItem) => (
    new Date(right.latestPurchaseAt ?? 0).getTime() - new Date(left.latestPurchaseAt ?? 0).getTime()
    || byCard(left, right)
  );

  if (sort === "card-name") {
    return [...items].sort(byCard);
  }

  if (sort === "total-value") {
    return [...items].sort((left, right) => (
      (right.currentTotalValueUsd ?? Number.NEGATIVE_INFINITY) - (left.currentTotalValueUsd ?? Number.NEGATIVE_INFINITY)
      || byLatestPurchaseDesc(left, right)
    ));
  }

  if (sort === "total-cost") {
    return [...items].sort((left, right) => (
      (right.totalCostUsd ?? Number.NEGATIVE_INFINITY) - (left.totalCostUsd ?? Number.NEGATIVE_INFINITY)
      || byLatestPurchaseDesc(left, right)
    ));
  }

  if (sort === "biggest-gain") {
    return [...items].sort((left, right) => (
      (right.deltaUsd ?? Number.NEGATIVE_INFINITY) - (left.deltaUsd ?? Number.NEGATIVE_INFINITY)
      || byLatestPurchaseDesc(left, right)
    ));
  }

  if (sort === "biggest-loss") {
    return [...items].sort((left, right) => (
      (left.deltaUsd ?? Number.POSITIVE_INFINITY) - (right.deltaUsd ?? Number.POSITIVE_INFINITY)
      || byLatestPurchaseDesc(left, right)
    ));
  }

  return [...items].sort(byLatestPurchaseDesc);
}

function filterCollectorItems(items: CollectorOverviewItem[], filters: CollectorOverviewFilters) {
  return items.filter((item) => {
    if (filters.deckId !== "all" && !item.decks.some((deck) => deck.id === filters.deckId)) {
      return false;
    }
    if (filters.profitability !== "all" && collectorProfitabilityState(item) !== filters.profitability) {
      return false;
    }
    if (filters.priceData === "limited-or-unavailable" && item.priceDataStatus === "available") {
      return false;
    }
    return true;
  });
}

function toBuyOpportunityItem(deckName: string, item: DeckWishlistItem): BuyOpportunityItem {
  return {
    key: `${item.deckId}:${item.id}`,
    deckId: item.deckId,
    deckName,
    wishlistItemId: item.id,
    cardName: item.cardName,
    scryfallId: item.scryfallId,
    resolvedIdentityKey: item.resolvedIdentityKey,
    targetQuantity: item.targetQuantity,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pricing: item.pricing,
    purchases: item.purchases,
    costBasis: item.costBasis
  };
}

function filterBuyOpportunityItems(items: BuyOpportunityItem[], filters: BuyOpportunityFilters) {
  return items.filter((item) => {
    if (filters.signal !== "all" && item.pricing.signal !== filters.signal) {
      return false;
    }
    if (filters.deckId !== "all" && item.deckId !== filters.deckId) {
      return false;
    }
    if (filters.historyStatus !== "all" && item.pricing.historyStatus !== filters.historyStatus) {
      return false;
    }
    return true;
  });
}

function sortBuyOpportunityItems(items: BuyOpportunityItem[], sort: BuyOpportunitySort) {
  const confidenceRank = (item: BuyOpportunityItem) => (item.pricing.confidence === "full" ? 0 : 1);
  const byCardThenDeckThenId = (left: BuyOpportunityItem, right: BuyOpportunityItem) => (
    left.cardName.localeCompare(right.cardName)
    || left.deckName.localeCompare(right.deckName)
    || left.deckId - right.deckId
    || left.wishlistItemId - right.wishlistItemId
  );

  if (sort === "card-name") {
    return [...items].sort(byCardThenDeckThenId);
  }

  if (sort === "deck-name") {
    return [...items].sort((left, right) => (
      left.deckName.localeCompare(right.deckName)
      || left.cardName.localeCompare(right.cardName)
      || left.deckId - right.deckId
      || left.wishlistItemId - right.wishlistItemId
    ));
  }

  if (sort === "current-price") {
    return [...items].sort((left, right) => {
      const leftPrice = left.pricing.currentPriceUsd ?? Number.POSITIVE_INFINITY;
      const rightPrice = right.pricing.currentPriceUsd ?? Number.POSITIVE_INFINITY;
      if (leftPrice !== rightPrice) {
        return leftPrice - rightPrice;
      }
      const confidenceDiff = confidenceRank(left) - confidenceRank(right);
      if (confidenceDiff !== 0) {
        return confidenceDiff;
      }
      return byCardThenDeckThenId(left, right);
    });
  }

  if (sort === "highest-discount") {
    return [...items].sort((left, right) => {
      const leftDelta = left.pricing.deltaPercent ?? Number.POSITIVE_INFINITY;
      const rightDelta = right.pricing.deltaPercent ?? Number.POSITIVE_INFINITY;
      if (leftDelta !== rightDelta) {
        return leftDelta - rightDelta;
      }
      const confidenceDiff = confidenceRank(left) - confidenceRank(right);
      if (confidenceDiff !== 0) {
        return confidenceDiff;
      }
      return byCardThenDeckThenId(left, right);
    });
  }

  const signalRank: Record<DeckWishlistSignal, number> = {
    "good-moment": 0,
    normal: 1,
    "expensive-now": 2
  };

  return [...items].sort((left, right) => {
    const signalDiff = signalRank[left.pricing.signal] - signalRank[right.pricing.signal];
    if (signalDiff !== 0) {
      return signalDiff;
    }
    const confidenceDiff = confidenceRank(left) - confidenceRank(right);
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    const leftDelta = left.pricing.deltaPercent ?? Number.POSITIVE_INFINITY;
    const rightDelta = right.pricing.deltaPercent ?? Number.POSITIVE_INFINITY;
    if (leftDelta !== rightDelta) {
      return leftDelta - rightDelta;
    }
    return byCardThenDeckThenId(left, right);
  });
}

async function resolveWishlistIdentity(input: { cardName: string; scryfallId?: string | null }) {
  const normalizedName = normalizeNullable(input.cardName);
  const explicitScryfallId = normalizeNullable(input.scryfallId);

  if (explicitScryfallId && normalizedName) {
    return {
      cardName: normalizedName,
      scryfallId: explicitScryfallId,
      resolvedIdentityKey: resolvedIdentityKey(normalizedName, explicitScryfallId)
    };
  }

  if (explicitScryfallId && !normalizedName) {
    let cardName = explicitScryfallId;
    let scryfallId = explicitScryfallId;

    try {
      const lookupResult = await getCardPricesByCollection([{ id: explicitScryfallId }]);
      const card = lookupResult.data[0] ?? null;
      cardName = card?.name ?? explicitScryfallId;
      scryfallId = card?.scryfallId ?? explicitScryfallId;
    } catch {
      // Fall back to explicit id identity when live lookup is unavailable.
    }

    return {
      cardName,
      scryfallId,
      resolvedIdentityKey: resolvedIdentityKey(cardName, scryfallId)
    };
  }

  if (!normalizedName) {
    return null;
  }

  try {
    const exact = await getCardByExactName(normalizedName);
    return {
      cardName: exact.name,
      scryfallId: normalizeNullable(exact.scryfallId),
      resolvedIdentityKey: resolvedIdentityKey(exact.name, exact.scryfallId ?? null)
    };
  } catch (error) {
    if (!(error instanceof ScryfallRouteError) || error.status !== 404) {
      // Degrade gracefully to local fallback identity.
    }
  }

  try {
    const fuzzy = await getCardByFuzzyName(normalizedName);
    return {
      cardName: fuzzy.name,
      scryfallId: normalizeNullable(fuzzy.scryfallId),
      resolvedIdentityKey: resolvedIdentityKey(fuzzy.name, fuzzy.scryfallId ?? null)
    };
  } catch (error) {
    if (!(error instanceof ScryfallRouteError) || error.status !== 404) {
      // Degrade gracefully to local fallback identity.
    }
  }

  return {
    cardName: normalizedName,
    scryfallId: null,
    resolvedIdentityKey: resolvedIdentityKey(normalizedName, null)
  };
}

export async function listDeckWishlist(
  deckId: number,
  sortBy: string | null,
  path = `/api/decks/${deckId}/wishlist`,
  ownerUserId?: number
): Promise<DeckWishlist | WishlistRouteError> {
  const database = await readDatabase();
  const deck = deckOwned(database, deckId, ownerUserId);
  if (!deck) {
    return notFound(path);
  }

  const sort = parseWishlistSort(sortBy);
  const items = database.wishlistItems
    .filter((item) => item.deckId === deckId)
    .map((item) => toWishlistItemResponse(database, deckId, item));

  return {
    deckId,
    currency: DEFAULT_CURRENCY,
    generatedAt: nowIso(),
    sort,
    items: sortWishlistItems(items, sort)
  };
}

export async function listBuyOpportunities(
  input: {
    sort?: string | null;
    signal?: string | null;
    deckId?: string | number | null;
    historyStatus?: string | null;
  } = {},
  path = "/api/buy-opportunities",
  ownerUserId?: number
): Promise<BuyOpportunities | WishlistRouteError> {
  if (ownerUserId == null) {
    return notFound(path);
  }

  const database = await readDatabase();
  const ownerDecks = database.decks
    .filter((deck) => deck.ownerUserId === ownerUserId)
    .map((deck) => ({ id: deck.id, name: deck.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);

  const sort = parseOpportunitiesSort(input.sort ?? null);
  const filters = parseOpportunitiesFilters(input);

  const opportunities = ownerDecks.flatMap((deck) => (
    database.wishlistItems
      .filter((item) => item.deckId === deck.id)
      .map((item) => toBuyOpportunityItem(deck.name, toWishlistItemResponse(database, deck.id, item)))
  ));

  const filtered = filterBuyOpportunityItems(opportunities, filters);
  return {
    generatedAt: nowIso(),
    currency: DEFAULT_CURRENCY,
    sort,
    filters,
    availableDecks: ownerDecks,
    items: sortBuyOpportunityItems(filtered, sort)
  };
}

export async function listCollectorOverview(
  input: {
    sort?: string | null;
    deckId?: string | number | null;
    profitability?: string | null;
    priceData?: string | null;
  } = {},
  path = "/api/collector-overview",
  ownerUserId?: number
): Promise<CollectorOverview | WishlistRouteError> {
  if (ownerUserId == null) {
    return notFound(path);
  }

  const database = await readDatabase();
  const ownerDecks = database.decks
    .filter((deck) => deck.ownerUserId === ownerUserId)
    .map((deck) => ({ id: deck.id, name: deck.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);

  const ownedDeckIdSet = new Set(ownerDecks.map((deck) => deck.id));
  const sort = parseCollectorSort(input.sort ?? null);
  const filters = parseCollectorFilters(input);

  const grouped = new Map<string, {
    resolvedIdentityKey: string;
    cardName: string;
    scryfallId: string | null;
    rawPurchases: StoredDeckCardPurchase[];
    purchases: CollectorOverviewPurchase[];
    deckLinks: Map<number, { id: number; name: string; wishlistItemId: number | null }>;
  }>();

  const deckNameById = new Map(ownerDecks.map((deck) => [deck.id, deck.name]));
  for (const purchase of database.deckCardPurchases) {
    if (!ownedDeckIdSet.has(purchase.deckId)) {
      continue;
    }

    const existing = grouped.get(purchase.resolvedIdentityKey) ?? {
      resolvedIdentityKey: purchase.resolvedIdentityKey,
      cardName: purchase.cardName,
      scryfallId: purchase.scryfallId,
      rawPurchases: [],
      purchases: [],
      deckLinks: new Map<number, { id: number; name: string; wishlistItemId: number | null }>()
    };

    if (!existing.scryfallId && purchase.scryfallId) {
      existing.scryfallId = purchase.scryfallId;
    }

    existing.rawPurchases.push(purchase);
    existing.purchases.push({
      id: purchase.id,
      deckId: purchase.deckId,
      deckName: deckNameById.get(purchase.deckId) ?? `Deck ${purchase.deckId}`,
      wishlistItemId: purchase.wishlistItemId,
      quantity: purchase.quantity,
      unitPriceUsd: round2(purchase.unitPriceUsd),
      purchasedAt: purchase.purchasedAt,
      createdAt: purchase.createdAt
    });

    const link = existing.deckLinks.get(purchase.deckId);
    if (!link) {
      existing.deckLinks.set(purchase.deckId, {
        id: purchase.deckId,
        name: deckNameById.get(purchase.deckId) ?? `Deck ${purchase.deckId}`,
        wishlistItemId: purchase.wishlistItemId
      });
    } else if (link.wishlistItemId == null && purchase.wishlistItemId != null) {
      link.wishlistItemId = purchase.wishlistItemId;
    }

    grouped.set(purchase.resolvedIdentityKey, existing);
  }

  const items = Array.from(grouped.values()).map((group): CollectorOverviewItem => {
    const sortedRawPurchases = [...group.rawPurchases].sort((left, right) => (
      new Date(right.purchasedAt).getTime() - new Date(left.purchasedAt).getTime()
      || right.id - left.id
    ));
    const sortedPurchases = [...group.purchases].sort((left, right) => (
      new Date(right.purchasedAt).getTime() - new Date(left.purchasedAt).getTime()
      || right.id - left.id
    ));
    const latestPurchase = sortedPurchases[0] ?? null;
    const primaryDeckLink = latestPurchase
      ? group.deckLinks.get(latestPurchase.deckId)
      : Array.from(group.deckLinks.values())[0];

    const historyPoints = buildOwnedIdentityHistoryPoints(
      database,
      ownedDeckIdSet,
      group.resolvedIdentityKey,
      group.scryfallId,
      group.cardName
    );
    const currentUnitPriceUsd = historyPoints[0]?.priceUsd ?? null;
    const costBasis = toWishlistCostBasis(sortedRawPurchases, currentUnitPriceUsd);
    const quantityTotal = costBasis.totalPurchasedQuantity;
    const averageCostBasisUsd = costBasis.averageCostBasisUsd;
    const totalCostUsd = costBasis.totalCostBasisUsd;
    const currentTotalValueUsd = costBasis.currentValueUsd;
    const deltaUsd = costBasis.deltaUsd;
    const deltaPercent = costBasis.deltaPercent;
    const priceDataStatus: DeckWishlistHistoryStatus = historyStatus(historyPoints);
    const confidence: DeckWishlistConfidence = group.scryfallId && historyPoints.length >= REF_PRICE_MIN_POINTS ? "full" : "limited";

    return {
      key: group.resolvedIdentityKey,
      cardName: group.cardName,
      scryfallId: group.scryfallId,
      resolvedIdentityKey: group.resolvedIdentityKey,
      decks: Array.from(group.deckLinks.values()).sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id),
      totalPurchasedQuantity: quantityTotal,
      averageCostBasisUsd,
      totalCostUsd,
      currentUnitPriceUsd,
      currentTotalValueUsd,
      deltaUsd,
      deltaPercent,
      latestPurchaseAt: latestPurchase?.purchasedAt ?? null,
      lastPriceCapturedAt: historyPoints[0]?.capturedAt ?? null,
      priceDataStatus,
      confidence,
      purchases: sortedPurchases,
      primaryDeckId: primaryDeckLink?.id ?? latestPurchase?.deckId ?? 0,
      primaryWishlistItemId: primaryDeckLink?.wishlistItemId ?? latestPurchase?.wishlistItemId ?? null
    };
  });

  return {
    generatedAt: nowIso(),
    currency: DEFAULT_CURRENCY,
    sort,
    filters,
    availableDecks: ownerDecks,
    items: sortCollectorItems(filterCollectorItems(items, filters), sort)
  };
}

export async function getCardDetail(
  identity: string,
  path = `/api/cards/${identity}`,
  ownerUserId?: number
): Promise<CardDetail | WishlistRouteError> {
  if (ownerUserId == null) {
    return {
      status: 401,
      body: {
        message: "Debes iniciar sesion."
      }
    };
  }

  const parsedIdentity = parseCardIdentityInput(identity);
  if (!parsedIdentity) {
    return badRequest(path, "Validation failed", ["Card identity is required."]);
  }

  const database = await readDatabase();
  const ownerDecks = database.decks
    .filter((deck) => deck.ownerUserId === ownerUserId)
    .map((deck) => ({ id: deck.id, name: deck.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  const ownedDeckIdSet = new Set(ownerDecks.map((deck) => deck.id));

  const matchedCards = database.cards.filter((card) => {
    if (!ownedDeckIdSet.has(card.deckId)) {
      return false;
    }
    const key = resolvedIdentityKey(card.name, card.scryfallId);
    return matchesIdentity(parsedIdentity, card.name, card.scryfallId, key);
  });

  const matchedWishlist = database.wishlistItems.filter((item) => {
    if (!ownedDeckIdSet.has(item.deckId)) {
      return false;
    }
    return matchesIdentity(parsedIdentity, item.cardName, item.scryfallId, item.resolvedIdentityKey);
  });

  const matchedPurchases = database.deckCardPurchases.filter((purchase) => {
    if (!ownedDeckIdSet.has(purchase.deckId)) {
      return false;
    }
    return matchesIdentity(parsedIdentity, purchase.cardName, purchase.scryfallId, purchase.resolvedIdentityKey);
  });

  if (matchedCards.length === 0 && matchedWishlist.length === 0 && matchedPurchases.length === 0) {
    return notFound(path);
  }

  const cardNameCandidates = [
    ...matchedCards.map((card) => card.name),
    ...matchedWishlist.map((item) => item.cardName),
    ...matchedPurchases.map((purchase) => purchase.cardName)
  ];
  const scryfallId = normalizeNullable(
    matchedCards.find((card) => normalize(card.scryfallId))?.scryfallId
    ?? matchedWishlist.find((item) => normalize(item.scryfallId))?.scryfallId
    ?? matchedPurchases.find((purchase) => normalize(purchase.scryfallId))?.scryfallId
  );
  const cardName = pickDisplayCardName(cardNameCandidates, parsedIdentity.value);
  const resolvedKey = resolvedIdentityKey(cardName, scryfallId);

  const cardsByDeck = new Map<number, { quantity: number }[]>();
  for (const card of matchedCards) {
    const list = cardsByDeck.get(card.deckId) ?? [];
    list.push({ quantity: card.quantity });
    cardsByDeck.set(card.deckId, list);
  }

  const wishlistByDeck = new Map<number, { id: number; targetQuantity: number }[]>();
  for (const item of matchedWishlist) {
    const list = wishlistByDeck.get(item.deckId) ?? [];
    list.push({ id: item.id, targetQuantity: item.targetQuantity });
    wishlistByDeck.set(item.deckId, list);
  }

  const historyPoints = buildOwnedIdentityHistoryPoints(
    database,
    ownedDeckIdSet,
    resolvedKey,
    scryfallId,
    cardName
  );
  const currentPriceUsd = historyPoints[0]?.priceUsd ?? null;
  const referencePoints = historyPoints.slice(0, REF_PRICE_POINT_WINDOW);
  const referencePriceUsd = referencePoints.length >= REF_PRICE_MIN_POINTS
    ? round2(referencePoints.reduce((sum, point) => sum + point.priceUsd, 0) / referencePoints.length)
    : null;
  const deltaUsd = currentPriceUsd != null && referencePriceUsd != null ? round2(currentPriceUsd - referencePriceUsd) : null;
  const deltaPercent = deltaUsd != null && referencePriceUsd != null && referencePriceUsd > 0
    ? round2((deltaUsd / referencePriceUsd) * 100)
    : null;
  const coverage = pricingCoverageState({ cardName, scryfallId }, historyPoints);
  const comparisonReason = pricingComparisonReason({
    currentPriceUsd,
    referencePriceUsd,
    points: historyPoints
  });

  const sortedRawPurchases = [...matchedPurchases].sort((left, right) => (
    new Date(right.purchasedAt).getTime() - new Date(left.purchasedAt).getTime()
    || right.id - left.id
  ));
  const costBasis = toWishlistCostBasis(sortedRawPurchases, currentPriceUsd);
  const deckNameById = new Map(ownerDecks.map((deck) => [deck.id, deck.name]));
  const purchases: CollectorOverviewPurchase[] = sortedRawPurchases.map((purchase) => ({
    id: purchase.id,
    deckId: purchase.deckId,
    deckName: deckNameById.get(purchase.deckId) ?? `Deck ${purchase.deckId}`,
    wishlistItemId: purchase.wishlistItemId,
    quantity: purchase.quantity,
    unitPriceUsd: round2(purchase.unitPriceUsd),
    purchasedAt: purchase.purchasedAt,
    createdAt: purchase.createdAt
  }));

  const deckRows = buildDeckUsageRows(ownerDecks, cardsByDeck, wishlistByDeck);
  const wishlistRows = deckRows.filter((row) => row.wishlistItemId != null);

  return {
    identity: resolvedKey,
    cardName,
    scryfallId,
    currency: DEFAULT_CURRENCY,
    generatedAt: nowIso(),
    pricing: {
      currentPriceUsd,
      referencePriceUsd,
      deltaUsd,
      deltaPercent,
      signal: signalForDeltaPercent(deltaPercent),
      confidence: scryfallId && historyPoints.length >= REF_PRICE_MIN_POINTS ? "full" : "limited",
      historyStatus: historyStatus(historyPoints),
      lastCapturedAt: historyPoints[0]?.capturedAt ?? null,
      coverageState: coverage.state,
      coverageReason: coverage.reason,
      comparisonReason
    },
    history: historyPoints,
    decks: deckRows,
    wishlistDecks: wishlistRows,
    purchases,
    costBasis
  };
}

export async function addDeckWishlistItem(
  deckId: number,
  payload: unknown,
  path = `/api/decks/${deckId}/wishlist`,
  ownerUserId?: number
): Promise<DeckWishlistItem | WishlistRouteError> {
  if (!payload || typeof payload !== "object") {
    return badRequest(path, "Validation failed", ["Payload must be a JSON object."]);
  }

  const body = payload as { cardName?: unknown; name?: unknown; scryfallId?: unknown; targetQuantity?: unknown };
  const requestedName = normalizeNullable(body.cardName) ?? normalizeNullable(body.name);
  const requestedScryfallId = normalizeNullable(body.scryfallId);
  const parsedQuantity = typeof body.targetQuantity === "number" ? Math.trunc(body.targetQuantity) : 1;

  if (!requestedName && !requestedScryfallId) {
    return badRequest(path, "Validation failed", ["Card name or scryfallId is required."]);
  }

  if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > PURCHASE_MAX_QUANTITY) {
    return badRequest(path, "Validation failed", [`targetQuantity must be between 1 and ${PURCHASE_MAX_QUANTITY}.`]);
  }

  const resolved = await resolveWishlistIdentity({
    cardName: requestedName ?? "",
    scryfallId: requestedScryfallId
  });

  if (!resolved) {
    return badRequest(path, "Validation failed", ["Could not resolve card identity."]);
  }

  return withDatabaseWrite((database) => {
    const deck = deckOwned(database, deckId, ownerUserId);
    if (!deck) {
      return notFound(path);
    }

    const now = nowIso();
    const existing = database.wishlistItems.find((item) => item.deckId === deckId && item.resolvedIdentityKey === resolved.resolvedIdentityKey);
    if (existing) {
      existing.targetQuantity += parsedQuantity;
      existing.updatedAt = now;
      if (!existing.scryfallId && resolved.scryfallId) {
        existing.scryfallId = resolved.scryfallId;
      }
      if (normalize(existing.cardName) !== normalize(resolved.cardName)) {
        existing.cardName = resolved.cardName;
      }

      return toWishlistItemResponse(database, deckId, existing);
    }

    const item: StoredWishlistItem = {
      id: database.nextWishlistItemId++,
      ownerUserId: deck.ownerUserId,
      deckId,
      cardName: resolved.cardName,
      scryfallId: resolved.scryfallId,
      resolvedIdentityKey: resolved.resolvedIdentityKey,
      targetQuantity: parsedQuantity,
      createdAt: now,
      updatedAt: now
    };

    database.wishlistItems.push(item);
    return toWishlistItemResponse(database, deckId, item);
  });
}

export async function deleteDeckWishlistItem(
  deckId: number,
  itemId: number,
  path = `/api/decks/${deckId}/wishlist/${itemId}`,
  ownerUserId?: number
): Promise<null | WishlistRouteError> {
  return withDatabaseWrite((database) => {
    const deck = deckOwned(database, deckId, ownerUserId);
    if (!deck) {
      return notFound(path);
    }

    const index = database.wishlistItems.findIndex((item) => item.deckId === deckId && item.id === itemId);
    if (index < 0) {
      return notFound(path);
    }

    const removed = database.wishlistItems[index];
    database.wishlistItems.splice(index, 1);
    database.deckCardPurchases = database.deckCardPurchases.map((purchase) => (
      purchase.wishlistItemId === removed.id
        ? {
            ...purchase,
            wishlistItemId: null
          }
        : purchase
    ));

    return null;
  });
}

export async function getDeckWishlistItemHistory(
  deckId: number,
  itemId: number,
  path = `/api/decks/${deckId}/wishlist/${itemId}/history`,
  ownerUserId?: number
): Promise<DeckWishlistHistory | WishlistRouteError> {
  const database = await readDatabase();
  const deck = deckOwned(database, deckId, ownerUserId);
  if (!deck) {
    return notFound(path);
  }

  const item = database.wishlistItems.find((entry) => entry.deckId === deckId && entry.id === itemId);
  if (!item) {
    return notFound(path);
  }

  const points = buildHistoryPoints(database, deckId, item);
  return {
    deckId,
    wishlistItemId: item.id,
    cardName: item.cardName,
    scryfallId: item.scryfallId,
    resolvedIdentityKey: item.resolvedIdentityKey,
    status: historyStatus(points),
    confidence: confidence(item, points),
    points
  };
}

function latestCachedIndexes(points: StoredWishlistPricePoint[]) {
  const latestByIdentity = new Map<string, StoredWishlistPricePoint>();
  const latestByScryfall = new Map<string, StoredWishlistPricePoint>();
  const latestByName = new Map<string, StoredWishlistPricePoint>();

  for (const point of points) {
    const capturedAtMs = new Date(point.capturedAt).getTime();
    const normalizedIdentity = normalize(point.resolvedIdentityKey);
    const normalizedScryfall = normalize(point.scryfallId);
    const normalizedName = normalize(point.cardName);

    const compareAndSet = (map: Map<string, StoredWishlistPricePoint>, key: string) => {
      if (!key) {
        return;
      }
      const existing = map.get(key);
      if (!existing || capturedAtMs > new Date(existing.capturedAt).getTime()) {
        map.set(key, point);
      }
    };

    compareAndSet(latestByIdentity, normalizedIdentity);
    compareAndSet(latestByScryfall, normalizedScryfall);
    compareAndSet(latestByName, normalizedName);
  }

  return {
    latestByIdentity,
    latestByScryfall,
    latestByName
  };
}

function latestPointForTarget(
  indexes: ReturnType<typeof latestCachedIndexes>,
  target: { resolvedIdentityKey: string; scryfallId: string | null; cardName: string }
) {
  const byIdentity = indexes.latestByIdentity.get(normalize(target.resolvedIdentityKey));
  const byScryfall = indexes.latestByScryfall.get(normalize(target.scryfallId));
  const byName = indexes.latestByName.get(normalize(target.cardName));
  const candidates = [byIdentity, byScryfall, byName].filter((value): value is StoredWishlistPricePoint => Boolean(value));
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime())[0] ?? null;
}

type PricingRefreshTarget = {
  resolvedIdentityKey: string;
  cardName: string;
  scryfallId: string | null;
};

async function enrichDeckWishlistIdentities(database: DatabaseShape, deckId: number) {
  const items = database.wishlistItems.filter((item) => item.deckId === deckId);
  if (items.length === 0) {
    return {
      resolvedCount: 0,
      mergedCount: 0,
      unresolvedCount: 0
    };
  }

  let resolvedCount = 0;
  let mergedCount = 0;
  let unresolvedCount = 0;

  for (const item of [...items]) {
    const current = database.wishlistItems.find((entry) => entry.id === item.id && entry.deckId === deckId);
    if (!current) {
      continue;
    }

    const shouldResolve = !normalize(current.scryfallId) || normalize(current.resolvedIdentityKey).startsWith("name:");
    if (!shouldResolve) {
      continue;
    }

    const resolved = await resolveWishlistIdentity({
      cardName: current.cardName,
      scryfallId: current.scryfallId
    });

    if (!resolved) {
      unresolvedCount += 1;
      continue;
    }

    if (!normalize(resolved.scryfallId)) {
      unresolvedCount += 1;
      continue;
    }

    const oldIdentityKey = current.resolvedIdentityKey;
    const oldCardName = current.cardName;
    const oldScryfallId = current.scryfallId;
    const changed = normalize(oldIdentityKey) !== normalize(resolved.resolvedIdentityKey)
      || normalize(oldCardName) !== normalize(resolved.cardName)
      || normalize(oldScryfallId) !== normalize(resolved.scryfallId);
    if (!changed) {
      continue;
    }

    const conflict = database.wishlistItems.find((entry) => (
      entry.deckId === deckId
      && entry.id !== current.id
      && normalize(entry.resolvedIdentityKey) === normalize(resolved.resolvedIdentityKey)
    ));

    const now = nowIso();
    if (conflict) {
      conflict.targetQuantity += current.targetQuantity;
      conflict.updatedAt = now;
      if (!normalize(conflict.scryfallId) && resolved.scryfallId) {
        conflict.scryfallId = resolved.scryfallId;
      }
      if (normalize(conflict.cardName) !== normalize(resolved.cardName)) {
        conflict.cardName = resolved.cardName;
      }

      database.deckCardPurchases = database.deckCardPurchases.map((purchase) => (
        purchase.deckId === deckId && purchase.wishlistItemId === current.id
          ? {
              ...purchase,
              wishlistItemId: conflict.id,
              resolvedIdentityKey: conflict.resolvedIdentityKey,
              cardName: conflict.cardName,
              scryfallId: conflict.scryfallId ?? purchase.scryfallId
            }
          : purchase
      ));
      database.wishlistItems = database.wishlistItems.filter((entry) => entry.id !== current.id);
      mergedCount += 1;
      continue;
    }

    current.cardName = resolved.cardName;
    current.scryfallId = resolved.scryfallId;
    current.resolvedIdentityKey = resolved.resolvedIdentityKey;
    current.updatedAt = now;
    database.deckCardPurchases = database.deckCardPurchases.map((purchase) => (
      purchase.deckId === deckId && purchase.wishlistItemId === current.id
        ? {
            ...purchase,
            resolvedIdentityKey: resolved.resolvedIdentityKey,
            cardName: resolved.cardName,
            scryfallId: resolved.scryfallId
          }
        : purchase
    ));
    resolvedCount += 1;
  }

  return {
    resolvedCount,
    mergedCount,
    unresolvedCount
  };
}

function collectPricingRefreshTargets(database: DatabaseShape, deckId: number): PricingRefreshTarget[] {
  const targetsByKey = new Map<string, PricingRefreshTarget>();
  const addTarget = (input: { cardName: string; scryfallId: string | null | undefined; resolvedIdentityKey?: string | null }) => {
    const cardName = normalizeNullable(input.cardName) ?? "";
    const scryfallId = normalizeNullable(input.scryfallId);
    const identity = normalizeNullable(input.resolvedIdentityKey) ?? resolvedIdentityKey(cardName || (scryfallId ?? "card"), scryfallId);
    if (!identity || !cardName) {
      return;
    }
    const key = normalize(identity);
    if (!targetsByKey.has(key)) {
      targetsByKey.set(key, {
        resolvedIdentityKey: identity,
        cardName,
        scryfallId
      });
    }
  };

  for (const item of database.wishlistItems) {
    if (item.deckId !== deckId) {
      continue;
    }
    addTarget(item);
  }

  for (const card of database.cards) {
    if (card.deckId !== deckId) {
      continue;
    }
    addTarget({
      cardName: card.name,
      scryfallId: card.scryfallId,
      resolvedIdentityKey: resolvedIdentityKey(card.name, card.scryfallId)
    });
  }

  for (const purchase of database.deckCardPurchases) {
    if (purchase.deckId !== deckId) {
      continue;
    }
    addTarget(purchase);
  }

  return [...targetsByKey.values()];
}

export async function refreshDeckWishlistPricing(
  deckId: number,
  path = `/api/decks/${deckId}/wishlist/refresh`,
  ownerUserId?: number
): Promise<DeckWishlistRefreshResult | WishlistRouteError> {
  return withDatabaseWrite(async (database) => {
    const deck = deckOwned(database, deckId, ownerUserId);
    if (!deck) {
      return notFound(path);
    }

    const identityEnrichment = await enrichDeckWishlistIdentities(database, deckId);
    const items = database.wishlistItems.filter((item) => item.deckId === deckId);
    if (items.length === 0) {
      return {
        deckId,
        refreshedAt: nowIso(),
        ttlHours: Math.round(PRICE_REFRESH_TTL_MS / (1000 * 60 * 60)),
        scannedItems: 0,
        staleItems: 0,
        refreshedItems: 0,
        unresolvedItems: 0,
        note: "No hay items en wishlist para refrescar.",
        diagnostics: {
          totalTargets: 0,
          staleTargets: 0,
          missingIdentityTargets: 0,
          unresolvedIdentityTargets: identityEnrichment.unresolvedCount,
          sampledUnresolvedCards: []
        }
      };
    }

    const targets = collectPricingRefreshTargets(database, deckId);
    const indexes = latestCachedIndexes(database.wishlistPriceHistory);
    const nowMs = Date.now();
    const staleTargets = targets.filter((target) => {
      const point = latestPointForTarget(indexes, target);
      if (!point) {
        return true;
      }

      const age = nowMs - new Date(point.capturedAt).getTime();
      return !Number.isFinite(age) || age >= PRICE_REFRESH_TTL_MS;
    });
    const missingIdentityTargets = targets.filter((target) => !normalize(target.scryfallId)).length;

    if (staleTargets.length === 0) {
      return {
        deckId,
        refreshedAt: nowIso(),
        ttlHours: Math.round(PRICE_REFRESH_TTL_MS / (1000 * 60 * 60)),
        scannedItems: items.length,
        staleItems: 0,
        refreshedItems: 0,
        unresolvedItems: 0,
        note: "Todos los precios siguen dentro del TTL.",
        diagnostics: {
          totalTargets: targets.length,
          staleTargets: 0,
          missingIdentityTargets,
          unresolvedIdentityTargets: identityEnrichment.unresolvedCount,
          sampledUnresolvedCards: []
        }
      };
    }

    const seenIdentifiers = new Set<string>();
    const identifiers: Array<{ id?: string; name?: string }> = [];
    for (const target of staleTargets) {
      const idKey = normalize(target.scryfallId);
      const nameKey = normalize(target.cardName);
      const dedupeKey = idKey ? `id:${idKey}` : `name:${nameKey}`;
      if (!dedupeKey || seenIdentifiers.has(dedupeKey)) {
        continue;
      }

      seenIdentifiers.add(dedupeKey);
      identifiers.push(idKey ? { id: target.scryfallId ?? undefined } : { name: target.cardName });
    }

    let refreshedItems = 0;
    let unresolvedItems = 0;
    const unresolvedSamples: string[] = [];
    const refreshedAt = nowIso();
    const capturedDay = toDay(refreshedAt);

    try {
      const lookups = await getCardPricesByCollection(identifiers);
      const lookupByKey = new Map<string, { name: string; scryfallId?: string | null; priceUsd: number | null }>();

      for (const lookup of lookups.data) {
        const idKey = normalize(lookup.scryfallId);
        const nameKey = normalize(lookup.name);
        if (idKey) {
          lookupByKey.set(`id:${idKey}`, lookup);
        }
        if (nameKey) {
          lookupByKey.set(`name:${nameKey}`, lookup);
        }
      }

      for (const target of staleTargets) {
        const idKey = normalize(target.scryfallId);
        const identityKey = idKey ? `id:${idKey}` : `name:${normalize(target.cardName)}`;
        const lookup = lookupByKey.get(identityKey) ?? lookupByKey.get(`name:${normalize(target.cardName)}`) ?? null;

        if (!lookup || lookup.priceUsd == null) {
          unresolvedItems += 1;
          if (unresolvedSamples.length < PRICE_REFRESH_DIAGNOSTIC_SAMPLE_LIMIT) {
            unresolvedSamples.push(target.cardName);
          }
          continue;
        }

        const nextScryfallId = lookup.scryfallId ?? target.scryfallId;
        const nextIdentityKey = resolvedIdentityKey(lookup.name, nextScryfallId);
        const historyIndex = database.wishlistPriceHistory.findIndex((point) => (
          normalize(point.resolvedIdentityKey) === normalize(nextIdentityKey) && point.capturedDay === capturedDay
        ));

        if (historyIndex >= 0) {
          const existing = database.wishlistPriceHistory[historyIndex];
          existing.priceUsd = round2(lookup.priceUsd);
          existing.capturedAt = refreshedAt;
          existing.source = "live-current";
          existing.cardName = lookup.name;
          existing.resolvedIdentityKey = nextIdentityKey;
          existing.scryfallId = nextScryfallId;
        } else {
          database.wishlistPriceHistory.push({
            id: database.nextWishlistPricePointId++,
            resolvedIdentityKey: nextIdentityKey,
            scryfallId: nextScryfallId,
            cardName: lookup.name,
            capturedDay,
            capturedAt: refreshedAt,
            priceUsd: round2(lookup.priceUsd),
            source: "live-current"
          });
        }

        refreshedItems += 1;
      }
    } catch {
      unresolvedItems = staleTargets.length;
      unresolvedSamples.push(...staleTargets.slice(0, PRICE_REFRESH_DIAGNOSTIC_SAMPLE_LIMIT).map((target) => target.cardName));
    }

    const noteParts: string[] = [];
    if (identityEnrichment.resolvedCount > 0) {
      noteParts.push(`${identityEnrichment.resolvedCount} identidad(es) de wishlist se normalizaron`);
    }
    if (identityEnrichment.mergedCount > 0) {
      noteParts.push(`${identityEnrichment.mergedCount} duplicado(s) se consolidaron`);
    }
    if (refreshedItems > 0) {
      noteParts.push(`${refreshedItems} objetivo(s) de precio se actualizaron`);
    }
    if (unresolvedItems > 0) {
      noteParts.push(`${unresolvedItems} objetivo(s) siguen sin precio`);
    }

    return {
      deckId,
      refreshedAt,
      ttlHours: Math.round(PRICE_REFRESH_TTL_MS / (1000 * 60 * 60)),
      scannedItems: items.length,
      staleItems: staleTargets.length,
      refreshedItems,
      unresolvedItems,
      note: noteParts.length > 0
        ? `${noteParts.join(". ")}.`
        : "No se pudo refrescar pricing externo ahora mismo; se mantiene cache local.",
      diagnostics: {
        totalTargets: targets.length,
        staleTargets: staleTargets.length,
        missingIdentityTargets,
        unresolvedIdentityTargets: identityEnrichment.unresolvedCount,
        sampledUnresolvedCards: [...new Set(unresolvedSamples)]
      }
    };
  });
}

function parsePurchasePayload(payload: unknown, path: string) {
  if (!payload || typeof payload !== "object") {
    return badRequest(path, "Validation failed", ["Payload must be a JSON object."]);
  }

  const body = payload as {
    wishlistItemId?: unknown;
    cardName?: unknown;
    scryfallId?: unknown;
    quantity?: unknown;
    unitPriceUsd?: unknown;
    purchasedAt?: unknown;
  };

  const wishlistItemIdRaw = typeof body.wishlistItemId === "number" ? Math.trunc(body.wishlistItemId) : null;
  const wishlistItemId = wishlistItemIdRaw != null ? wishlistItemIdRaw : null;
  const cardName = normalizeNullable(body.cardName);
  const scryfallId = normalizeNullable(body.scryfallId);
  const quantity = typeof body.quantity === "number" ? Math.trunc(body.quantity) : Number.NaN;
  const unitPriceUsd = typeof body.unitPriceUsd === "number" ? body.unitPriceUsd : Number.NaN;
  const purchasedAtRaw = normalizeNullable(body.purchasedAt);
  let purchasedAt = nowIso();
  if (purchasedAtRaw) {
    const parsedDate = new Date(purchasedAtRaw);
    if (!Number.isFinite(parsedDate.getTime())) {
      return badRequest(path, "Validation failed", ["purchasedAt must be a valid date/time string."]);
    }
    purchasedAt = parsedDate.toISOString();
  }

  if (wishlistItemId != null && wishlistItemId < 1) {
    return badRequest(path, "Validation failed", ["wishlistItemId must be >= 1 when provided."]);
  }

  if (!Number.isFinite(quantity) || quantity < 1 || quantity > PURCHASE_MAX_QUANTITY) {
    return badRequest(path, "Validation failed", [`quantity must be between 1 and ${PURCHASE_MAX_QUANTITY}.`]);
  }

  if (!Number.isFinite(unitPriceUsd) || unitPriceUsd < 0 || unitPriceUsd > PURCHASE_MAX_UNIT_PRICE_USD) {
    return badRequest(path, "Validation failed", [`unitPriceUsd must be between 0 and ${PURCHASE_MAX_UNIT_PRICE_USD}.`]);
  }

  if (Math.abs(unitPriceUsd * 100 - Math.round(unitPriceUsd * 100)) > 0.001) {
    return badRequest(path, "Validation failed", ["unitPriceUsd must have at most two decimal places."]);
  }

  if (new Date(purchasedAt).getTime() > Date.now() + 1000 * 60 * 5) {
    return badRequest(path, "Validation failed", ["purchasedAt cannot be in the future."]);
  }

  if (!wishlistItemId && !cardName && !scryfallId) {
    return badRequest(path, "Validation failed", ["Provide wishlistItemId or card identity."]);
  }

  return {
    wishlistItemId,
    cardName,
    scryfallId,
    quantity,
    unitPriceUsd: round2(unitPriceUsd),
    purchasedAt
  };
}

function buildDeckAllowedIdentityKeys(database: DatabaseShape, deckId: number) {
  const keys = new Set<string>();

  for (const card of database.cards) {
    if (card.deckId !== deckId) {
      continue;
    }
    keys.add(resolvedIdentityKey(card.name, card.scryfallId));
    keys.add(resolvedIdentityKey(card.name, null));
  }

  for (const item of database.wishlistItems) {
    if (item.deckId !== deckId) {
      continue;
    }
    keys.add(item.resolvedIdentityKey);
    keys.add(resolvedIdentityKey(item.cardName, null));
  }

  return keys;
}

export async function createDeckWishlistPurchase(
  deckId: number,
  payload: unknown,
  path = `/api/decks/${deckId}/purchases`,
  ownerUserId?: number
): Promise<DeckWishlistPurchase | WishlistRouteError> {
  const parsed = parsePurchasePayload(payload, path);
  if ("status" in parsed) {
    return parsed;
  }

  return withDatabaseWrite((database) => {
    const deck = deckOwned(database, deckId, ownerUserId);
    if (!deck) {
      return notFound(path);
    }

    let resolvedKey = "";
    let resolvedCardName = "";
    let resolvedScryfallId: string | null = null;
    let wishlistItemId: number | null = null;

    if (parsed.wishlistItemId != null) {
      const wishlistItem = database.wishlistItems.find((item) => item.deckId === deckId && item.id === parsed.wishlistItemId);
      if (!wishlistItem) {
        return badRequest(path, "Validation failed", ["wishlistItemId does not belong to this deck."]);
      }

      resolvedKey = wishlistItem.resolvedIdentityKey;
      resolvedCardName = wishlistItem.cardName;
      resolvedScryfallId = wishlistItem.scryfallId;
      wishlistItemId = wishlistItem.id;
    } else {
      resolvedCardName = parsed.cardName ?? parsed.scryfallId ?? "Card";
      resolvedScryfallId = parsed.scryfallId;
      resolvedKey = resolvedIdentityKey(resolvedCardName, resolvedScryfallId);
    }

    const allowedKeys = buildDeckAllowedIdentityKeys(database, deckId);
    if (!allowedKeys.has(resolvedKey)) {
      return badRequest(path, "Validation failed", ["Purchases are limited to cards in this deck or its wishlist."]);
    }

    const purchase: StoredDeckCardPurchase = {
      id: database.nextDeckCardPurchaseId++,
      ownerUserId: deck.ownerUserId,
      deckId,
      wishlistItemId,
      resolvedIdentityKey: resolvedKey,
      cardName: resolvedCardName,
      scryfallId: resolvedScryfallId,
      quantity: parsed.quantity,
      unitPriceUsd: parsed.unitPriceUsd,
      purchasedAt: parsed.purchasedAt,
      createdAt: nowIso()
    };

    database.deckCardPurchases.push(purchase);
    return toWishlistPurchaseResponse(purchase);
  });
}

export async function deleteDeckWishlistPurchase(
  deckId: number,
  purchaseId: number,
  path = `/api/decks/${deckId}/purchases/${purchaseId}`,
  ownerUserId?: number
): Promise<null | WishlistRouteError> {
  return withDatabaseWrite((database) => {
    const deck = deckOwned(database, deckId, ownerUserId);
    if (!deck) {
      return notFound(path);
    }

    const purchaseIndex = database.deckCardPurchases.findIndex((purchase) => purchase.deckId === deckId && purchase.id === purchaseId);
    if (purchaseIndex < 0) {
      return notFound(path);
    }

    database.deckCardPurchases.splice(purchaseIndex, 1);
    return null;
  });
}
