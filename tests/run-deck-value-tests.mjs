import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      throw error;
    });
}

process.env.MTG_DB_PATH = path.join(os.tmpdir(), `mtg-deck-value-${Date.now()}.sqlite`);

const priceState = new Map([
  ["Sol Ring", 1.5],
  ["Dockside Extortionist", 60],
  ["Mountain", 0.1]
]);

global.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("api.scryfall.com")) {
    throw new Error(`Unexpected URL ${url}`);
  }

  if (url.includes("/cards/collection")) {
    const payload = JSON.parse(init.body ?? "{}");
    const identifiers = Array.isArray(payload.identifiers) ? payload.identifiers : [];
    const data = [];
    const notFound = [];

    for (const identifier of identifiers) {
      const name = identifier.name ?? null;
      const id = identifier.id ?? null;
      const resolvedName = name ?? (id === "sol-ring-id" ? "Sol Ring" : id === "dockside-id" ? "Dockside Extortionist" : id === "mountain-id" ? "Mountain" : null);
      if (!resolvedName || !priceState.has(resolvedName)) {
        notFound.push(identifier);
        continue;
      }

      data.push({
        id: id ?? `${resolvedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-id`,
        name: resolvedName,
        cmc: resolvedName === "Mountain" ? 0 : resolvedName === "Sol Ring" ? 1 : 2,
        type_line: resolvedName === "Mountain" ? "Basic Land — Mountain" : resolvedName === "Sol Ring" ? "Artifact" : "Creature — Goblin Pirate",
        colors: resolvedName === "Mountain" ? ["R"] : resolvedName === "Dockside Extortionist" ? ["R"] : [],
        prices: { usd: String(priceState.get(resolvedName)) },
        image_uris: {
          small: `https://img.test/${resolvedName}/small.jpg`,
          normal: `https://img.test/${resolvedName}/normal.jpg`
        }
      });
    }

    return new Response(JSON.stringify({ data, not_found: notFound }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  throw new Error(`Unhandled mock URL ${url}`);
};

const { withDatabaseWrite, readDatabase } = await import("../lib/server/mtg-store.ts");
const { initializeDeckValueTracking, refreshDeckValueSnapshotsInDatabase, ensureDeckValueTracker, ensurePortfolioValueTracker } = await import("../lib/server/deck-value.ts");
const { findReusableMetadata, mergeReusableMetadata } = await import("../lib/card-metadata.ts");
const { deleteDeckCard } = await import("../lib/server/mtg-domain.ts");

await runTest("deck value tracking replaces an empty baseline with the first meaningful priced snapshot", async () => {
  await withDatabaseWrite((database) => {
    database.users.push({
      id: 2,
      email: "value@test.local",
      passwordHash: "hash",
      createdAt: "2026-04-05T10:00:00.000Z",
      isBootstrapLegacyOwner: false
    });
    database.nextUserId = 3;
    database.decks.push({
      id: 1,
      ownerUserId: 2,
      name: "Value Test",
      format: "Commander",
      commander: "Dockside Extortionist",
      createdAt: "2026-04-05T10:00:00.000Z"
    });
    database.nextDeckId = 2;
    initializeDeckValueTracking(database, 1, "deck-create");
    database.cards.push(
      {
        id: 1,
        deckId: 1,
        name: "Dockside Extortionist",
        manaValue: 2,
        type: "Creature — Goblin Pirate",
        colors: "R",
        quantity: 1,
        scryfallId: "dockside-id",
        imageSmall: null,
        imageNormal: null,
        imageUrl: null
      },
      {
        id: 2,
        deckId: 1,
        name: "Sol Ring",
        manaValue: 1,
        type: "Artifact",
        colors: "C",
        quantity: 1,
        scryfallId: "sol-ring-id",
        imageSmall: null,
        imageNormal: null,
        imageUrl: null
      },
      {
        id: 3,
        deckId: 1,
        name: "Mountain",
        manaValue: 0,
        type: "Basic Land — Mountain",
        colors: "R",
        quantity: 10,
        scryfallId: "mountain-id",
        imageSmall: null,
        imageNormal: null,
        imageUrl: null
      }
    );
    database.nextCardId = 4;
  });

  await withDatabaseWrite((database) => refreshDeckValueSnapshotsInDatabase(database, 1, {
    source: "deck-import",
    replaceEmptyBaseline: true,
    force: true
  }));

  const tracker = await ensureDeckValueTracker(1);
  assert.ok(tracker);
  assert.equal(tracker.status, "ready");
  assert.equal(tracker.baselineValue, 62.5);
  assert.equal(tracker.currentValue, 62.5);
  assert.equal(tracker.deltaValue, 0);
  assert.equal(tracker.pricedCardCount, 3);
});

await runTest("current valuation refresh computes deltas, movers, and portfolio totals", async () => {
  priceState.set("Dockside Extortionist", 72);
  priceState.set("Sol Ring", 1.8);
  priceState.set("Mountain", 0.12);

  await withDatabaseWrite((database) => refreshDeckValueSnapshotsInDatabase(database, 1, {
    source: "deck-read",
    force: true
  }));

  const tracker = await ensureDeckValueTracker(1);
  assert.ok(tracker);
  assert.equal(tracker.currentValue, 75);
  assert.equal(tracker.baselineValue, 62.5);
  assert.equal(tracker.deltaValue, 12.5);
  assert.equal(tracker.deltaPercent, 20);
  assert.equal(tracker.topRisers[0]?.cardName, "Dockside Extortionist");
  assert.equal(tracker.topRisers[0]?.deltaValue, 12);

  const portfolio = await ensurePortfolioValueTracker(2);
  assert.equal(portfolio.summary.deckCount, 1);
  assert.equal(portfolio.summary.totalCurrentValue, 75);
  assert.equal(portfolio.summary.totalDeltaValue, 12.5);
});

await runTest("local metadata reuse can repair fallback-imported cards without external lookup", async () => {
  const brokenCard = {
    id: 10,
    name: "Dimir Signet",
    manaValue: 0,
    type: "Unknown",
    colors: "Colorless",
    quantity: 1,
    scryfallId: null,
    imageSmall: null,
    imageNormal: null,
    imageUrl: null
  };

  const knownCard = {
    id: 11,
    name: "Dimir Signet",
    manaValue: 2,
    type: "Artifact",
    colors: "C",
    quantity: 1,
    scryfallId: "known-dimir-signet",
    imageSmall: "small.jpg",
    imageNormal: "normal.jpg",
    imageUrl: "normal.jpg"
  };

  const reusable = findReusableMetadata(brokenCard, [brokenCard, knownCard]);
  assert.equal(reusable?.id, knownCard.id);

  const repaired = mergeReusableMetadata(brokenCard, knownCard);
  assert.equal(repaired.manaValue, 2);
  assert.equal(repaired.type, "Artifact");
  assert.equal(repaired.colors, "C");
  assert.equal(repaired.scryfallId, "known-dimir-signet");
  assert.equal(repaired.imageNormal, "normal.jpg");
});

await runTest("deleting a deck card detaches historical value snapshots instead of violating foreign keys", async () => {
  await withDatabaseWrite((database) => {
    database.users.push({
      id: 3,
      email: "delete@test.local",
      passwordHash: "hash",
      createdAt: "2026-04-05T11:00:00.000Z",
      isBootstrapLegacyOwner: false
    });
    database.nextUserId = 4;
    database.decks.push({
      id: 2,
      ownerUserId: 3,
      name: "Delete Test",
      format: "Commander",
      commander: "Sol Ring",
      createdAt: "2026-04-05T11:00:00.000Z"
    });
    database.nextDeckId = 3;
    initializeDeckValueTracking(database, 2, "deck-create");
    database.cards.push(
      {
        id: 20,
        deckId: 2,
        name: "Sol Ring",
        manaValue: 1,
        type: "Artifact",
        colors: "C",
        quantity: 1,
        scryfallId: "sol-ring-id",
        imageSmall: null,
        imageNormal: null,
        imageUrl: null
      },
      {
        id: 21,
        deckId: 2,
        name: "Mountain",
        manaValue: 0,
        type: "Basic Land - Mountain",
        colors: "R",
        quantity: 5,
        scryfallId: "mountain-id",
        imageSmall: null,
        imageNormal: null,
        imageUrl: null
      }
    );
    database.nextCardId = 22;
  });

  await withDatabaseWrite((database) => refreshDeckValueSnapshotsInDatabase(database, 2, {
    source: "deck-import",
    replaceEmptyBaseline: true,
    force: true
  }));

  const result = await deleteDeckCard(2, 20, "/api/decks/2/cards/20", 3);
  assert.equal(result, null);

  const persisted = await readDatabase();
  assert.equal(persisted.cards.some((card) => card.id === 20), false);
  const detachedSnapshots = persisted.cardValueSnapshots.filter((snapshot) => snapshot.deckId === 2 && snapshot.cardName === "Sol Ring");
  assert.ok(detachedSnapshots.length > 0);
  assert.equal(detachedSnapshots.every((snapshot) => snapshot.cardId === null), true);
});

console.log("All deck value tracker tests passed.");
