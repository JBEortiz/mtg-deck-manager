import "server-only";

import type {
  CardPriceLookupResult,
  DeckPortfolio,
  DeckPortfolioSummary,
  DeckValueCoverageCard,
  DeckValueMover,
  DeckValueTracker,
  PortfolioDeckValue
} from "@/lib/types";
import {
  readDatabase,
  type DatabaseShape,
  type StoredCard,
  type StoredCardValueSnapshot,
  type StoredDeck,
  type StoredDeckValueSnapshot,
  withDatabaseWrite
} from "@/lib/server/mtg-store";
import { getCardPriceByExactName, getCardPriceByFuzzyName, getCardPricesByCollection, ScryfallRouteError } from "@/lib/scryfall/server";

const DEFAULT_CURRENCY = "USD";
const CURRENT_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 6;
const MAX_TOP_MOVERS = 5;
const MAX_COLLECTION_BATCH = 75;

type PricingLine = {
  card: StoredCard;
  priceUsd: number | null;
  status: "priced" | "missing";
};

function normalize(value: string | null | undefined) {
  return value == null ? "" : value.trim().toLowerCase();
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function deckCards(database: DatabaseShape, deckId: number) {
  return database.cards.filter((card) => card.deckId === deckId).sort((left, right) => left.id - right.id);
}

function latestDeckSnapshot(database: DatabaseShape, deckId: number, snapshotKind: StoredDeckValueSnapshot["snapshotKind"]) {
  return [...database.deckValueSnapshots]
    .filter((snapshot) => snapshot.deckId === deckId && snapshot.snapshotKind === snapshotKind)
    .sort((left, right) => new Date(right.snapshotAt).getTime() - new Date(left.snapshotAt).getTime() || right.id - left.id)[0] ?? null;
}

function snapshotCardRows(database: DatabaseShape, deckSnapshotId: number) {
  return database.cardValueSnapshots.filter((snapshot) => snapshot.deckSnapshotId === deckSnapshotId);
}

function isMeaningfulSnapshot(snapshot: StoredDeckValueSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  return snapshot.totalValue > 0 || snapshot.pricedCardCount > 0 || snapshot.missingPriceCardCount > 0;
}

function isSnapshotStale(snapshot: StoredDeckValueSnapshot | null) {
  if (!snapshot) {
    return true;
  }

  const age = Date.now() - new Date(snapshot.snapshotAt).getTime();
  return !Number.isFinite(age) || age >= CURRENT_SNAPSHOT_MAX_AGE_MS;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function resolvePricingLines(cards: StoredCard[]): Promise<PricingLine[]> {
  const uniqueCards = new Map<string, StoredCard>();

  for (const card of cards) {
    const key = card.scryfallId ? `id:${normalize(card.scryfallId)}` : `name:${normalize(card.name)}`;
    if (!uniqueCards.has(key)) {
      uniqueCards.set(key, card);
    }
  }

  const uniqueEntries = [...uniqueCards.values()];
  const priceByKey = new Map<string, CardPriceLookupResult>();
  const unresolvedEntries: StoredCard[] = [];

  for (const identifierChunk of chunk(uniqueEntries, MAX_COLLECTION_BATCH)) {
    const { data, notFound } = await getCardPricesByCollection(
      identifierChunk.map((card) => ({
        id: card.scryfallId ?? undefined,
        name: card.scryfallId ? undefined : card.name
      }))
    );

    for (const lookup of data) {
      if (lookup.scryfallId) {
        priceByKey.set(`id:${normalize(lookup.scryfallId)}`, lookup);
      }
      priceByKey.set(`name:${normalize(lookup.name)}`, lookup);
    }

    const unresolvedKeys = new Set(
      notFound.map((entry) => entry.id ? `id:${normalize(entry.id)}` : `name:${normalize(entry.name)}`)
    );

    for (const card of identifierChunk) {
      const key = card.scryfallId ? `id:${normalize(card.scryfallId)}` : `name:${normalize(card.name)}`;
      if (!priceByKey.has(key) && unresolvedKeys.has(key)) {
        unresolvedEntries.push(card);
      }
    }
  }

  for (const card of unresolvedEntries) {
    const key = card.scryfallId ? `id:${normalize(card.scryfallId)}` : `name:${normalize(card.name)}`;
    if (priceByKey.has(key)) {
      continue;
    }

    try {
      const exact = await getCardPriceByExactName(card.name);
      if (exact.scryfallId) {
        priceByKey.set(`id:${normalize(exact.scryfallId)}`, exact);
      }
      priceByKey.set(`name:${normalize(exact.name)}`, exact);
      continue;
    } catch (error) {
      if (!(error instanceof ScryfallRouteError) || error.status !== 404) {
        throw error;
      }
    }

    try {
      const fuzzy = await getCardPriceByFuzzyName(card.name);
      if (fuzzy.scryfallId) {
        priceByKey.set(`id:${normalize(fuzzy.scryfallId)}`, fuzzy);
      }
      priceByKey.set(`name:${normalize(fuzzy.name)}`, fuzzy);
    } catch (error) {
      if (!(error instanceof ScryfallRouteError) || error.status !== 404) {
        throw error;
      }
    }
  }

  return cards.map((card) => {
    const key = card.scryfallId ? `id:${normalize(card.scryfallId)}` : `name:${normalize(card.name)}`;
    const byNameKey = `name:${normalize(card.name)}`;
    const lookup = priceByKey.get(key) ?? priceByKey.get(byNameKey) ?? null;
    return {
      card,
      priceUsd: lookup?.priceUsd ?? null,
      status: lookup?.priceUsd == null ? "missing" : "priced"
    };
  });
}

function createDeckSnapshot(
  database: DatabaseShape,
  deckId: number,
  snapshotKind: StoredDeckValueSnapshot["snapshotKind"],
  source: string,
  totalValue: number,
  pricedCardCount: number,
  missingPriceCardCount: number,
  note: string | null
) {
  const snapshot: StoredDeckValueSnapshot = {
    id: database.nextDeckValueSnapshotId++,
    deckId,
    snapshotKind,
    source,
    snapshotAt: new Date().toISOString(),
    currency: DEFAULT_CURRENCY,
    totalValue,
    pricedCardCount,
    missingPriceCardCount,
    note
  };

  database.deckValueSnapshots.push(snapshot);
  return snapshot;
}

function createCardSnapshots(database: DatabaseShape, deckSnapshotId: number, deckId: number, pricingLines: PricingLine[]) {
  const snapshots = pricingLines.map((entry) => {
    const totalValue = entry.priceUsd == null ? null : Number((entry.priceUsd * entry.card.quantity).toFixed(2));
    const snapshot: StoredCardValueSnapshot = {
      id: database.nextCardValueSnapshotId++,
      deckSnapshotId,
      deckId,
      cardId: entry.card.id,
      cardName: entry.card.name,
      quantity: entry.card.quantity,
      scryfallId: entry.card.scryfallId,
      imageUrl: firstNonBlank(entry.card.imageNormal, entry.card.imageSmall, entry.card.imageUrl),
      currency: DEFAULT_CURRENCY,
      unitPrice: entry.priceUsd == null ? null : Number(entry.priceUsd.toFixed(2)),
      totalValue,
      status: entry.status
    };

    database.cardValueSnapshots.push(snapshot);
    return snapshot;
  });

  return snapshots;
}

function seedZeroSnapshotsIfMissing(database: DatabaseShape, deckId: number, source: string) {
  const baseline = latestDeckSnapshot(database, deckId, "baseline");
  const current = latestDeckSnapshot(database, deckId, "current");

  if (!baseline) {
    createDeckSnapshot(database, deckId, "baseline", source, 0, 0, 0, "Deck sin cartas valorables todavia.");
  }

  if (!current) {
    createDeckSnapshot(database, deckId, "current", source, 0, 0, 0, "Deck sin cartas valorables todavia.");
  }
}

export function initializeDeckValueTracking(database: DatabaseShape, deckId: number, source = "create") {
  seedZeroSnapshotsIfMissing(database, deckId, source);
}

export async function refreshDeckValueSnapshotsInDatabase(
  database: DatabaseShape,
  deckId: number,
  options: {
    source: string;
    force?: boolean;
    replaceEmptyBaseline?: boolean;
  }
) {
  const cards = deckCards(database, deckId);
  const existingBaseline = latestDeckSnapshot(database, deckId, "baseline");
  const existingCurrent = latestDeckSnapshot(database, deckId, "current");

  if (cards.length === 0) {
    seedZeroSnapshotsIfMissing(database, deckId, options.source);
    return {
      usedStaleSnapshot: false,
      refreshed: true
    };
  }

  if (!options.force && existingCurrent && !isSnapshotStale(existingCurrent)) {
    if ((!isMeaningfulSnapshot(existingBaseline) || options.replaceEmptyBaseline) && isMeaningfulSnapshot(existingCurrent)) {
      const currentRows = snapshotCardRows(database, existingCurrent.id).map((row) => ({
        card: {
          id: row.cardId ?? -1,
          deckId,
          name: row.cardName,
          manaValue: 0,
          type: "Unknown",
          colors: "Colorless",
          quantity: row.quantity,
          scryfallId: row.scryfallId,
          imageSmall: null,
          imageNormal: row.imageUrl,
          imageUrl: row.imageUrl
        } satisfies StoredCard,
        priceUsd: row.unitPrice,
        status: row.status
      }));
      const baselineSnapshot = createDeckSnapshot(
        database,
        deckId,
        "baseline",
        `${options.source}:baseline-bootstrap`,
        existingCurrent.totalValue,
        existingCurrent.pricedCardCount,
        existingCurrent.missingPriceCardCount,
        existingCurrent.note
      );
      createCardSnapshots(database, baselineSnapshot.id, deckId, currentRows);
    }

    return {
      usedStaleSnapshot: false,
      refreshed: false
    };
  }

  const pricingLines = await resolvePricingLines(cards);
  const totalValue = Number(
    pricingLines.reduce((sum, entry) => sum + ((entry.priceUsd ?? 0) * entry.card.quantity), 0).toFixed(2)
  );
  const pricedCardCount = pricingLines.filter((entry) => entry.status === "priced").length;
  const missingPriceCardCount = pricingLines.filter((entry) => entry.status === "missing").length;
  const note = missingPriceCardCount > 0
    ? `${missingPriceCardCount} carta(s) siguen sin precio disponible ahora mismo.`
    : null;

  const currentSnapshot = createDeckSnapshot(
    database,
    deckId,
    "current",
    options.source,
    totalValue,
    pricedCardCount,
    missingPriceCardCount,
    note
  );
  createCardSnapshots(database, currentSnapshot.id, deckId, pricingLines);

  if (!isMeaningfulSnapshot(existingBaseline) || options.replaceEmptyBaseline) {
    const baselineSnapshot = createDeckSnapshot(
      database,
      deckId,
      "baseline",
      `${options.source}:baseline`,
      totalValue,
      pricedCardCount,
      missingPriceCardCount,
      note
    );
    createCardSnapshots(database, baselineSnapshot.id, deckId, pricingLines);
  }

  return {
    usedStaleSnapshot: false,
    refreshed: true
  };
}

function isComparablePricedRow(row: StoredCardValueSnapshot | null) {
  return Boolean(
    row
    && row.status === "priced"
    && row.totalValue != null
    && Number.isFinite(row.totalValue)
  );
}

function asCoverageCard(
  key: string,
  row: StoredCardValueSnapshot,
  totalValue: number
): DeckValueCoverageCard {
  return {
    key,
    cardId: row.cardId ?? null,
    cardName: row.cardName,
    quantity: row.quantity,
    imageUrl: row.imageUrl,
    scryfallId: row.scryfallId ?? null,
    totalValue: Number(totalValue.toFixed(2))
  };
}

function buildValueComparison(
  baselineRows: StoredCardValueSnapshot[],
  currentRows: StoredCardValueSnapshot[]
): {
  comparableBaselineValue: number;
  comparableCurrentValue: number;
  comparableCardCount: number;
  newlyPricedCardCount: number;
  newlyPricedTotalValue: number;
  lostPricedCardCount: number;
  lostPricedTotalValue: number;
  newlyPricedCards: DeckValueCoverageCard[];
  lostPricedCards: DeckValueCoverageCard[];
  topRisers: DeckValueMover[];
  topFallers: DeckValueMover[];
} {
  const baselineByKey = new Map<string, StoredCardValueSnapshot>();
  const currentByKey = new Map<string, StoredCardValueSnapshot>();

  for (const row of baselineRows) {
    baselineByKey.set(row.scryfallId ? `id:${normalize(row.scryfallId)}` : `name:${normalize(row.cardName)}`, row);
  }

  for (const row of currentRows) {
    currentByKey.set(row.scryfallId ? `id:${normalize(row.scryfallId)}` : `name:${normalize(row.cardName)}`, row);
  }

  const allKeys = new Set([...baselineByKey.keys(), ...currentByKey.keys()]);
  const movers: DeckValueMover[] = [];
  const newlyPricedCards: DeckValueCoverageCard[] = [];
  const lostPricedCards: DeckValueCoverageCard[] = [];
  let comparableBaselineValue = 0;
  let comparableCurrentValue = 0;
  let comparableCardCount = 0;
  let newlyPricedTotalValue = 0;
  let lostPricedTotalValue = 0;

  for (const key of allKeys) {
    const baseline = baselineByKey.get(key) ?? null;
    const current = currentByKey.get(key) ?? null;
    const baselineComparable = isComparablePricedRow(baseline);
    const currentComparable = isComparablePricedRow(current);

    if (baselineComparable && currentComparable) {
      const baselineTotalValue = Number((baseline?.totalValue ?? 0).toFixed(2));
      const currentTotalValue = Number((current?.totalValue ?? 0).toFixed(2));
      comparableBaselineValue += baselineTotalValue;
      comparableCurrentValue += currentTotalValue;
      comparableCardCount += 1;

      const deltaValue = Number((currentTotalValue - baselineTotalValue).toFixed(2));
      if (deltaValue === 0) {
        continue;
      }

      const deltaPercent = baselineTotalValue > 0
        ? Number((((currentTotalValue - baselineTotalValue) / baselineTotalValue) * 100).toFixed(2))
        : null;

      movers.push({
        key,
        cardId: current?.cardId ?? baseline?.cardId ?? null,
        cardName: current?.cardName ?? baseline?.cardName ?? "Carta",
        quantity: current?.quantity ?? baseline?.quantity ?? 0,
        imageUrl: firstNonBlank(current?.imageUrl, baseline?.imageUrl),
        scryfallId: current?.scryfallId ?? baseline?.scryfallId ?? null,
        baselineTotalValue,
        currentTotalValue,
        deltaValue,
        deltaPercent
      });
      continue;
    }

    if (!baselineComparable && currentComparable && current) {
      const currentTotalValue = Number((current.totalValue ?? 0).toFixed(2));
      newlyPricedTotalValue += currentTotalValue;
      newlyPricedCards.push(asCoverageCard(key, current, currentTotalValue));
      continue;
    }

    if (baselineComparable && !currentComparable && baseline) {
      const baselineTotalValue = Number((baseline.totalValue ?? 0).toFixed(2));
      lostPricedTotalValue += baselineTotalValue;
      lostPricedCards.push(asCoverageCard(key, baseline, baselineTotalValue));
    }
  }

  const roundedComparableBaselineValue = Number(comparableBaselineValue.toFixed(2));
  const roundedComparableCurrentValue = Number(comparableCurrentValue.toFixed(2));
  const roundedNewlyPricedTotalValue = Number(newlyPricedTotalValue.toFixed(2));
  const roundedLostPricedTotalValue = Number(lostPricedTotalValue.toFixed(2));

  const topRisers = [...movers]
    .filter((mover) => mover.deltaValue > 0)
    .sort((left, right) => right.deltaValue - left.deltaValue)
    .slice(0, MAX_TOP_MOVERS);

  const topFallers = [...movers]
    .filter((mover) => mover.deltaValue < 0)
    .sort((left, right) => left.deltaValue - right.deltaValue)
    .slice(0, MAX_TOP_MOVERS);

  const topNewlyPriced = [...newlyPricedCards]
    .sort((left, right) => right.totalValue - left.totalValue)
    .slice(0, MAX_TOP_MOVERS);

  const topLostPriced = [...lostPricedCards]
    .sort((left, right) => right.totalValue - left.totalValue)
    .slice(0, MAX_TOP_MOVERS);

  return {
    comparableBaselineValue: roundedComparableBaselineValue,
    comparableCurrentValue: roundedComparableCurrentValue,
    comparableCardCount,
    newlyPricedCardCount: newlyPricedCards.length,
    newlyPricedTotalValue: roundedNewlyPricedTotalValue,
    lostPricedCardCount: lostPricedCards.length,
    lostPricedTotalValue: roundedLostPricedTotalValue,
    newlyPricedCards: topNewlyPriced,
    lostPricedCards: topLostPriced,
    topRisers,
    topFallers
  };
}

function buildTrackerNote(input: {
  unavailableNote: string;
  activeSnapshotNote: string | null;
  comparableCardCount: number;
  newlyPricedCardCount: number;
  lostPricedCardCount: number;
}) {
  if (input.unavailableNote) {
    return input.unavailableNote;
  }

  const comparableNote = input.comparableCardCount > 0
    ? `Variacion real calculada sobre ${input.comparableCardCount} carta(s) con precio en base y actual.`
    : "Aun no hay cartas comparables con precio en base y actual.";

  const coverageParts: string[] = [];
  if (input.newlyPricedCardCount > 0) {
    coverageParts.push(`${input.newlyPricedCardCount} carta(s) con precio nuevo`);
  }
  if (input.lostPricedCardCount > 0) {
    coverageParts.push(`${input.lostPricedCardCount} carta(s) sin precio actual`);
  }

  const coverageNote = coverageParts.length > 0
    ? `Cobertura: ${coverageParts.join(" | ")}.`
    : "Cobertura sin cambios relevantes.";

  const snapshotNote = input.activeSnapshotNote ? ` ${input.activeSnapshotNote}` : "";
  return `${comparableNote} ${coverageNote}${snapshotNote}`.trim();
}

function buildTrackerFromDatabase(database: DatabaseShape, deckId: number, usedStaleSnapshot: boolean, unavailableNote = ""): DeckValueTracker {
  const baseline = latestDeckSnapshot(database, deckId, "baseline");
  const current = latestDeckSnapshot(database, deckId, "current");
  const baselineRows = baseline ? snapshotCardRows(database, baseline.id) : [];
  const currentRows = current ? snapshotCardRows(database, current.id) : [];

  if (!current && !baseline) {
    return {
      deckId,
      currency: DEFAULT_CURRENCY,
      baselineValue: null,
      currentValue: null,
      deltaValue: null,
      deltaPercent: null,
      baselineCapturedAt: null,
      currentSnapshotAt: null,
      lastUpdated: null,
      usedStaleSnapshot: false,
      status: "unavailable",
      note: unavailableNote || "Todavia no hay snapshot de valor para este deck.",
      pricedCardCount: 0,
      missingPriceCardCount: 0,
      comparableCardCount: 0,
      newlyPricedCardCount: 0,
      newlyPricedTotalValue: 0,
      lostPricedCardCount: 0,
      lostPricedTotalValue: 0,
      newlyPricedCards: [],
      lostPricedCards: [],
      topRisers: [],
      topFallers: []
    };
  }

  const activeCurrent = current ?? baseline;
  const baselineValue = baseline?.totalValue ?? null;
  const currentValue = activeCurrent?.totalValue ?? null;
  const comparison = buildValueComparison(baselineRows, currentRows);
  const deltaValue = comparison.comparableCardCount > 0
    ? Number((comparison.comparableCurrentValue - comparison.comparableBaselineValue).toFixed(2))
    : null;
  const deltaPercent = comparison.comparableCardCount > 0 && comparison.comparableBaselineValue > 0
    ? Number((((comparison.comparableCurrentValue - comparison.comparableBaselineValue) / comparison.comparableBaselineValue) * 100).toFixed(2))
    : null;

  let status: DeckValueTracker["status"] = "ready";
  if ((activeCurrent?.pricedCardCount ?? 0) === 0 && (activeCurrent?.missingPriceCardCount ?? 0) === 0) {
    status = "empty";
  } else if (usedStaleSnapshot) {
    status = "stale";
  } else if ((activeCurrent?.missingPriceCardCount ?? 0) > 0) {
    status = "partial";
  }

  return {
    deckId,
    currency: activeCurrent?.currency ?? DEFAULT_CURRENCY,
    baselineValue,
    currentValue,
    deltaValue,
    deltaPercent,
    baselineCapturedAt: baseline?.snapshotAt ?? null,
    currentSnapshotAt: current?.snapshotAt ?? null,
    lastUpdated: activeCurrent?.snapshotAt ?? null,
    usedStaleSnapshot,
    status,
    note: buildTrackerNote({
      unavailableNote,
      activeSnapshotNote: activeCurrent?.note ?? null,
      comparableCardCount: comparison.comparableCardCount,
      newlyPricedCardCount: comparison.newlyPricedCardCount,
      lostPricedCardCount: comparison.lostPricedCardCount
    }),
    pricedCardCount: activeCurrent?.pricedCardCount ?? 0,
    missingPriceCardCount: activeCurrent?.missingPriceCardCount ?? 0,
    comparableCardCount: comparison.comparableCardCount,
    newlyPricedCardCount: comparison.newlyPricedCardCount,
    newlyPricedTotalValue: comparison.newlyPricedTotalValue,
    lostPricedCardCount: comparison.lostPricedCardCount,
    lostPricedTotalValue: comparison.lostPricedTotalValue,
    newlyPricedCards: comparison.newlyPricedCards,
    lostPricedCards: comparison.lostPricedCards,
    topRisers: comparison.topRisers,
    topFallers: comparison.topFallers
  };
}

export async function ensureDeckValueTracker(deckId: number): Promise<DeckValueTracker | null> {
  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck) {
      return null;
    }

    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "deck-read",
        replaceEmptyBaseline: !isMeaningfulSnapshot(latestDeckSnapshot(database, deckId, "baseline"))
      });
      return buildTrackerFromDatabase(database, deckId, false);
    } catch (error) {
      const current = latestDeckSnapshot(database, deckId, "current");
      if (current) {
        return buildTrackerFromDatabase(database, deckId, true, "Mostrando el ultimo snapshot disponible mientras el pricing externo se recupera.");
      }

      return buildTrackerFromDatabase(
        database,
        deckId,
        false,
        error instanceof Error ? error.message : "No se pudo calcular el valor actual del deck."
      );
    }
  });
}

function deckToPortfolioEntry(deck: StoredDeck, tracker: DeckValueTracker): PortfolioDeckValue {
  return {
    deck: {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt
    },
    tracker
  };
}

function buildPortfolioSummary(entries: PortfolioDeckValue[]): DeckPortfolioSummary {
  const totals = entries.reduce(
    (accumulator, entry) => {
      accumulator.deckCount += 1;
      if (entry.tracker.baselineValue != null) {
        accumulator.totalBaselineValue += entry.tracker.baselineValue;
        accumulator.hasBaseline = true;
      }
      if (entry.tracker.currentValue != null) {
        accumulator.totalCurrentValue += entry.tracker.currentValue;
        accumulator.hasCurrent = true;
      }
      if (!accumulator.lastUpdated || (entry.tracker.lastUpdated && entry.tracker.lastUpdated > accumulator.lastUpdated)) {
        accumulator.lastUpdated = entry.tracker.lastUpdated;
      }
      return accumulator;
    },
    {
      deckCount: 0,
      totalBaselineValue: 0,
      totalCurrentValue: 0,
      hasBaseline: false,
      hasCurrent: false,
      lastUpdated: null as string | null
    }
  );

  const totalBaselineValue = totals.hasBaseline ? Number(totals.totalBaselineValue.toFixed(2)) : null;
  const totalCurrentValue = totals.hasCurrent ? Number(totals.totalCurrentValue.toFixed(2)) : null;
  const totalDeltaValue = totalBaselineValue != null && totalCurrentValue != null
    ? Number((totalCurrentValue - totalBaselineValue).toFixed(2))
    : null;
  const totalDeltaPercent = totalBaselineValue != null && totalCurrentValue != null && totalBaselineValue > 0
    ? Number((((totalCurrentValue - totalBaselineValue) / totalBaselineValue) * 100).toFixed(2))
    : null;

  return {
    currency: DEFAULT_CURRENCY,
    deckCount: totals.deckCount,
    totalBaselineValue,
    totalCurrentValue,
    totalDeltaValue,
    totalDeltaPercent,
    lastUpdated: totals.lastUpdated
  };
}

export async function ensurePortfolioValueTracker(ownerUserId: number): Promise<DeckPortfolio> {
  return withDatabaseWrite(async (database) => {
    const ownedDecks = database.decks.filter((deck) => deck.ownerUserId === ownerUserId);
    const trackers: PortfolioDeckValue[] = [];

    for (const deck of ownedDecks) {
      let usedStaleSnapshot = false;
      let note = "";

      try {
        await refreshDeckValueSnapshotsInDatabase(database, deck.id, {
          source: "portfolio-read",
          replaceEmptyBaseline: !isMeaningfulSnapshot(latestDeckSnapshot(database, deck.id, "baseline"))
        });
      } catch (error) {
        usedStaleSnapshot = Boolean(latestDeckSnapshot(database, deck.id, "current"));
        note = error instanceof Error ? error.message : "No se pudo actualizar el valor del deck.";
      }

      trackers.push(deckToPortfolioEntry(deck, buildTrackerFromDatabase(database, deck.id, usedStaleSnapshot, note)));
    }

    trackers.sort((left, right) => {
      const leftValue = left.tracker.currentValue ?? -1;
      const rightValue = right.tracker.currentValue ?? -1;
      if (rightValue !== leftValue) {
        return rightValue - leftValue;
      }
      return left.deck.name.localeCompare(right.deck.name);
    });

    return {
      currency: DEFAULT_CURRENCY,
      summary: buildPortfolioSummary(trackers),
      decks: trackers
    };
  });
}
