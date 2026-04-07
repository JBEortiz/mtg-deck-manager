import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { convertCurrencyAmount, freshnessLabel } from "../lib/collector-ui.ts";

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

process.env.MTG_DB_PATH = path.join(os.tmpdir(), `mtg-deck-wishlist-${Date.now()}.sqlite`);

const cardCatalog = new Map([
  ["sol ring", { id: "sol-ring-id", name: "Sol Ring", cmc: 1, typeLine: "Artifact", colors: [], priceUsd: 1.5 }],
  ["rhystic study", { id: "rhystic-study-id", name: "Rhystic Study", cmc: 3, typeLine: "Enchantment", colors: ["U"], priceUsd: 30 }]
]);

function toScryfallCard(entry) {
  return {
    id: entry.id,
    name: entry.name,
    cmc: entry.cmc,
    type_line: entry.typeLine,
    colors: entry.colors,
    prices: { usd: String(entry.priceUsd) },
    image_uris: {
      small: `https://img.test/${entry.id}/small.jpg`,
      normal: `https://img.test/${entry.id}/normal.jpg`
    }
  };
}

global.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const parsedUrl = new URL(url);
  if (!parsedUrl.hostname.includes("api.scryfall.com")) {
    throw new Error(`Unexpected URL ${url}`);
  }

  if (parsedUrl.pathname === "/cards/named") {
    const exact = parsedUrl.searchParams.get("exact");
    const fuzzy = parsedUrl.searchParams.get("fuzzy");
    const key = (exact ?? fuzzy ?? "").trim().toLowerCase();
    const card = cardCatalog.get(key);

    if (!card) {
      return new Response(JSON.stringify({ details: "Card not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify(toScryfallCard(card)), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (parsedUrl.pathname === "/cards/collection") {
    const payload = JSON.parse(typeof init.body === "string" ? init.body : "{}");
    const identifiers = Array.isArray(payload.identifiers) ? payload.identifiers : [];
    const data = [];

    for (const identifier of identifiers) {
      const lookupId = typeof identifier?.id === "string" ? identifier.id.trim().toLowerCase() : "";
      const lookupName = typeof identifier?.name === "string" ? identifier.name.trim().toLowerCase() : "";
      const card = [...cardCatalog.values()].find((entry) => entry.id.toLowerCase() === lookupId)
        ?? cardCatalog.get(lookupName)
        ?? null;
      if (card) {
        data.push(toScryfallCard(card));
      }
    }

    return new Response(JSON.stringify({ data, not_found: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  throw new Error(`Unhandled mock URL ${url}`);
};

const { withDatabaseWrite } = await import("../lib/server/mtg-store.ts");
const {
  addDeckWishlistItem,
  createDeckWishlistPurchase,
  deleteDeckWishlistPurchase,
  deleteDeckWishlistItem,
  getCardDetail,
  getDeckWishlistItemHistory,
  listBuyOpportunities,
  listCollectorOverview,
  listDeckWishlist,
  refreshDeckWishlistPricing
} = await import("../lib/server/deck-wishlist.ts");

await withDatabaseWrite((database) => {
  database.users.push(
    {
      id: 2,
      email: "wishlist-owner@test.local",
      passwordHash: "hash",
      createdAt: "2026-04-05T12:00:00.000Z",
      isBootstrapLegacyOwner: false,
      preferredDisplayCurrency: "USD",
      showPriceFreshness: true
    },
    {
      id: 3,
      email: "wishlist-other@test.local",
      passwordHash: "hash",
      createdAt: "2026-04-05T12:00:00.000Z",
      isBootstrapLegacyOwner: false,
      preferredDisplayCurrency: "USD",
      showPriceFreshness: true
    }
  );
  database.nextUserId = 4;

  database.decks.push({
    id: 1,
    ownerUserId: 2,
    name: "Wishlist Deck",
    format: "Commander",
    commander: "Rhystic Study",
    createdAt: "2026-04-05T12:00:00.000Z"
  });
  database.nextDeckId = 2;
});

await runTest("wishlist duplicate adds merge into one deck row and increase target quantity", async () => {
  const first = await addDeckWishlistItem(1, { cardName: "Sol Ring", targetQuantity: 1 }, "/api/decks/1/wishlist", 2);
  assert.equal("status" in first, false);

  const second = await addDeckWishlistItem(1, { cardName: "Sol Ring", targetQuantity: 2 }, "/api/decks/1/wishlist", 2);
  assert.equal("status" in second, false);
  assert.equal(second.targetQuantity, 3);

  const wishlist = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in wishlist, false);
  assert.equal(wishlist.items.length, 1);
  assert.equal(wishlist.items[0]?.targetQuantity, 3);
  assert.equal(wishlist.items[0]?.cardName, "Sol Ring");
});

await runTest("wishlist pricing rows expose cached current/reference/delta/signal and sort by best opportunity", async () => {
  const rhystic = await addDeckWishlistItem(1, { cardName: "Rhystic Study", targetQuantity: 1 }, "/api/decks/1/wishlist", 2);
  assert.equal("status" in rhystic, false);

  const result = await addDeckWishlistItem(1, { cardName: "Totally Unknown Card", targetQuantity: 1 }, "/api/decks/1/wishlist", 2);
  assert.equal("status" in result, false);
  assert.equal(result.scryfallId, null);
  assert.ok(result.resolvedIdentityKey.startsWith("name:"));

  await withDatabaseWrite((database) => {
    const solRing = database.wishlistItems.find((item) => item.deckId === 1 && item.scryfallId === "sol-ring-id");
    const rhysticItem = database.wishlistItems.find((item) => item.deckId === 1 && item.scryfallId === "rhystic-study-id");
    assert.ok(solRing);
    assert.ok(rhysticItem);

    database.wishlistPriceHistory.push(
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: solRing.resolvedIdentityKey,
        scryfallId: solRing.scryfallId,
        cardName: solRing.cardName,
        capturedDay: "2026-04-01",
        capturedAt: "2026-04-01T10:00:00.000Z",
        priceUsd: 10,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: solRing.resolvedIdentityKey,
        scryfallId: solRing.scryfallId,
        cardName: solRing.cardName,
        capturedDay: "2026-04-02",
        capturedAt: "2026-04-02T10:00:00.000Z",
        priceUsd: 10,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: solRing.resolvedIdentityKey,
        scryfallId: solRing.scryfallId,
        cardName: solRing.cardName,
        capturedDay: "2026-04-03",
        capturedAt: "2026-04-03T10:00:00.000Z",
        priceUsd: 6,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: rhysticItem.resolvedIdentityKey,
        scryfallId: rhysticItem.scryfallId,
        cardName: rhysticItem.cardName,
        capturedDay: "2026-04-01",
        capturedAt: "2026-04-01T10:00:00.000Z",
        priceUsd: 10,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: rhysticItem.resolvedIdentityKey,
        scryfallId: rhysticItem.scryfallId,
        cardName: rhysticItem.cardName,
        capturedDay: "2026-04-02",
        capturedAt: "2026-04-02T10:00:00.000Z",
        priceUsd: 10,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: rhysticItem.resolvedIdentityKey,
        scryfallId: rhysticItem.scryfallId,
        cardName: rhysticItem.cardName,
        capturedDay: "2026-04-03",
        capturedAt: "2026-04-03T10:00:00.000Z",
        priceUsd: 20,
        source: "cache"
      }
    );
  });

  const wishlist = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in wishlist, false);
  assert.equal(wishlist.items.length, 3);
  assert.equal(wishlist.items[0]?.cardName, "Sol Ring");
  assert.equal(wishlist.items[0]?.pricing.signal, "good-moment");
  assert.equal(wishlist.items[0]?.pricing.currentPriceUsd, 6);
  assert.equal(wishlist.items[0]?.pricing.referencePriceUsd, 8.67);
  assert.equal(wishlist.items[0]?.pricing.deltaUsd, -2.67);
  assert.equal(wishlist.items[0]?.pricing.deltaPercent, -30.8);
  assert.equal(wishlist.items[0]?.pricing.historyStatus, "available");
  assert.equal(wishlist.items[0]?.pricing.confidence, "full");

  assert.equal(wishlist.items[1]?.cardName, "Totally Unknown Card");
  assert.equal(wishlist.items[1]?.pricing.signal, "normal");
  assert.equal(wishlist.items[1]?.pricing.currentPriceUsd, null);
  assert.equal(wishlist.items[1]?.pricing.referencePriceUsd, null);
  assert.equal(wishlist.items[1]?.pricing.historyStatus, "unavailable");
  assert.equal(wishlist.items[1]?.pricing.confidence, "limited");
  assert.equal(typeof wishlist.items[1]?.pricing.coverageReason, "string");
  assert.equal(wishlist.items[1]?.pricing.coverageState, "missing");
  assert.equal(typeof wishlist.items[1]?.pricing.comparisonReason, "string");

  assert.equal(wishlist.items[2]?.cardName, "Rhystic Study");
  assert.equal(wishlist.items[2]?.pricing.signal, "expensive-now");
});

await runTest("refresh pricing can normalize unresolved identity keys and merge duplicates safely", async () => {
  await withDatabaseWrite((database) => {
    database.wishlistItems.push(
      {
        id: database.nextWishlistItemId++,
        ownerUserId: 2,
        deckId: 1,
        cardName: "Rhystic Study",
        scryfallId: null,
        resolvedIdentityKey: "name:rhystic study",
        targetQuantity: 1,
        createdAt: "2026-04-06T10:10:00.000Z",
        updatedAt: "2026-04-06T10:10:00.000Z"
      }
    );
  });

  const refreshed = await refreshDeckWishlistPricing(1, "/api/decks/1/wishlist/refresh", 2);
  assert.equal("status" in refreshed, false);
  assert.ok(refreshed.refreshedItems >= 1);
  assert.ok((refreshed.diagnostics?.totalTargets ?? 0) >= 1);

  const wishlist = await listDeckWishlist(1, "name", "/api/decks/1/wishlist", 2);
  assert.equal("status" in wishlist, false);
  const rhysticRows = wishlist.items.filter((item) => item.cardName === "Rhystic Study");
  assert.equal(rhysticRows.length, 1);
  assert.equal(rhysticRows[0]?.scryfallId, "rhystic-study-id");
  assert.equal(rhysticRows[0]?.resolvedIdentityKey, "id:rhystic-study-id");
});

await runTest("best-opportunity keeps limited-confidence rows below equivalent full-confidence rows", async () => {
  await withDatabaseWrite((database) => {
    const rhysticItem = database.wishlistItems.find((item) => item.deckId === 1 && item.scryfallId === "rhystic-study-id");
    assert.ok(rhysticItem);
    database.wishlistPriceHistory = database.wishlistPriceHistory.filter((point) => point.resolvedIdentityKey !== rhysticItem.resolvedIdentityKey);
    database.wishlistPriceHistory.push(
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: rhysticItem.resolvedIdentityKey,
        scryfallId: rhysticItem.scryfallId,
        cardName: rhysticItem.cardName,
        capturedDay: "2026-04-01",
        capturedAt: "2026-04-01T10:00:00.000Z",
        priceUsd: 10,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: rhysticItem.resolvedIdentityKey,
        scryfallId: rhysticItem.scryfallId,
        cardName: rhysticItem.cardName,
        capturedDay: "2026-04-02",
        capturedAt: "2026-04-02T10:00:00.000Z",
        priceUsd: 10,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: rhysticItem.resolvedIdentityKey,
        scryfallId: rhysticItem.scryfallId,
        cardName: rhysticItem.cardName,
        capturedDay: "2026-04-03",
        capturedAt: "2026-04-03T10:00:00.000Z",
        priceUsd: 10.4,
        source: "cache"
      }
    );
  });

  const wishlist = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in wishlist, false);
  const rhysticIndex = wishlist.items.findIndex((item) => item.cardName === "Rhystic Study");
  const unknownIndex = wishlist.items.findIndex((item) => item.cardName === "Totally Unknown Card");
  assert.ok(rhysticIndex >= 0);
  assert.ok(unknownIndex >= 0);
  assert.equal(wishlist.items[rhysticIndex]?.pricing.signal, "normal");
  assert.equal(wishlist.items[rhysticIndex]?.pricing.confidence, "full");
  assert.equal(wishlist.items[unknownIndex]?.pricing.signal, "normal");
  assert.equal(wishlist.items[unknownIndex]?.pricing.confidence, "limited");
  assert.ok(rhysticIndex < unknownIndex);
});

await runTest("wishlist ownership is enforced for read and write operations", async () => {
  const foreignList = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 3);
  assert.equal(typeof foreignList, "object");
  assert.equal("status" in foreignList, true);
  assert.equal(foreignList.status, 404);

  const foreignAdd = await addDeckWishlistItem(1, { cardName: "Rhystic Study", targetQuantity: 1 }, "/api/decks/1/wishlist", 3);
  assert.equal(typeof foreignAdd, "object");
  assert.equal("status" in foreignAdd, true);
  assert.equal(foreignAdd.status, 404);
});

await runTest("wishlist delete removes only the targeted deck item", async () => {
  const beforeDelete = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in beforeDelete, false);
  const rhystic = beforeDelete.items.find((item) => item.cardName === "Rhystic Study");
  assert.ok(rhystic);

  const deleteResult = await deleteDeckWishlistItem(1, rhystic.id, `/api/decks/1/wishlist/${rhystic.id}`, 2);
  assert.equal(deleteResult, null);

  const afterDelete = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in afterDelete, false);
  assert.equal(afterDelete.items.some((item) => item.id === rhystic.id), false);
});

await runTest("wishlist history returns available status and local points", async () => {
  const added = await addDeckWishlistItem(1, { cardName: "History Probe Card", targetQuantity: 1 }, "/api/decks/1/wishlist", 2);
  assert.equal("status" in added, false);

  await withDatabaseWrite((database) => {
    database.wishlistPriceHistory.push(
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: added.resolvedIdentityKey,
        scryfallId: added.scryfallId,
        cardName: added.cardName,
        capturedDay: "2026-04-04",
        capturedAt: "2026-04-04T10:00:00.000Z",
        priceUsd: 3,
        source: "cache"
      },
      {
        id: database.nextWishlistPricePointId++,
        resolvedIdentityKey: added.resolvedIdentityKey,
        scryfallId: added.scryfallId,
        cardName: added.cardName,
        capturedDay: "2026-04-05",
        capturedAt: "2026-04-05T10:00:00.000Z",
        priceUsd: 4,
        source: "cache"
      }
    );
  });

  const history = await getDeckWishlistItemHistory(1, added.id, `/api/decks/1/wishlist/${added.id}/history`, 2);
  assert.equal("body" in history, false);
  assert.equal(history.status, "available");
  assert.ok(history.points.length >= 2);
  assert.equal(history.points[0]?.priceUsd, 4);
});

await runTest("deck purchase create/delete updates weighted cost basis and enforces scope guard", async () => {
  const wishlist = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in wishlist, false);
  const solRing = wishlist.items.find((item) => item.cardName === "Sol Ring");
  assert.ok(solRing);

  const firstPurchase = await createDeckWishlistPurchase(1, {
    wishlistItemId: solRing.id,
    quantity: 2,
    unitPriceUsd: 5,
    purchasedAt: "2026-04-04"
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in firstPurchase, false);
  assert.equal(firstPurchase.quantity, 2);
  assert.equal(firstPurchase.unitPriceUsd, 5);

  const secondPurchase = await createDeckWishlistPurchase(1, {
    wishlistItemId: solRing.id,
    quantity: 1,
    unitPriceUsd: 9,
    purchasedAt: "2026-04-05"
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in secondPurchase, false);

  const afterCreates = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in afterCreates, false);
  const solRingAfterCreates = afterCreates.items.find((item) => item.id === solRing.id);
  assert.ok(solRingAfterCreates);
  assert.equal(solRingAfterCreates.purchases.length, 2);
  assert.equal(solRingAfterCreates.costBasis.totalPurchasedQuantity, 3);
  assert.equal(solRingAfterCreates.costBasis.averageCostBasisUsd, 6.33);
  assert.equal(solRingAfterCreates.costBasis.totalCostBasisUsd, 19);
  const currentUnitPrice = solRingAfterCreates.pricing.currentPriceUsd ?? 0;
  const expectedCurrentValue = Number((currentUnitPrice * 3).toFixed(2));
  const expectedDelta = Number((expectedCurrentValue - 19).toFixed(2));
  const expectedDeltaPercent = currentUnitPrice > 0
    ? Number((((currentUnitPrice - 6.33) / 6.33) * 100).toFixed(2))
    : null;
  assert.equal(solRingAfterCreates.costBasis.currentValueUsd, expectedCurrentValue);
  assert.equal(solRingAfterCreates.costBasis.deltaUsd, expectedDelta);
  assert.equal(solRingAfterCreates.costBasis.deltaPercent, expectedDeltaPercent);

  const scopeBlocked = await createDeckWishlistPurchase(1, {
    cardName: "Card Outside Deck Scope",
    quantity: 1,
    unitPriceUsd: 1.5
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in scopeBlocked, true);
  assert.equal(scopeBlocked.status, 400);

  const deleteResult = await deleteDeckWishlistPurchase(1, firstPurchase.id, `/api/decks/1/purchases/${firstPurchase.id}`, 2);
  assert.equal(deleteResult, null);

  const afterDelete = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in afterDelete, false);
  const solRingAfterDelete = afterDelete.items.find((item) => item.id === solRing.id);
  assert.ok(solRingAfterDelete);
  assert.equal(solRingAfterDelete.purchases.length, 1);
  assert.equal(solRingAfterDelete.costBasis.totalPurchasedQuantity, 1);
  assert.equal(solRingAfterDelete.costBasis.averageCostBasisUsd, 9);
});

await runTest("best-opportunity ranking remains deterministic on full ties", async () => {
  const first = await addDeckWishlistItem(1, { cardName: "Tie Card", scryfallId: "tie-card-a", targetQuantity: 1 }, "/api/decks/1/wishlist", 2);
  const second = await addDeckWishlistItem(1, { cardName: "Tie Card", scryfallId: "tie-card-b", targetQuantity: 1 }, "/api/decks/1/wishlist", 2);
  assert.equal("status" in first, false);
  assert.equal("status" in second, false);

  await withDatabaseWrite((database) => {
    const sameCreatedAt = "2026-04-06T08:00:00.000Z";
    const firstRow = database.wishlistItems.find((item) => item.id === first.id);
    const secondRow = database.wishlistItems.find((item) => item.id === second.id);
    assert.ok(firstRow);
    assert.ok(secondRow);
    firstRow.createdAt = sameCreatedAt;
    secondRow.createdAt = sameCreatedAt;
    firstRow.updatedAt = sameCreatedAt;
    secondRow.updatedAt = sameCreatedAt;
  });

  const sorted = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in sorted, false);
  const tieRows = sorted.items.filter((item) => item.cardName === "Tie Card");
  assert.equal(tieRows.length, 2);
  assert.ok(tieRows[0].id < tieRows[1].id);
});

await runTest("refresh pricing is cache-first and writes at most one history point per day", async () => {
  const before = await withDatabaseWrite((database) => {
    const solRingItem = database.wishlistItems.find((item) => item.deckId === 1 && item.scryfallId === "sol-ring-id");
    assert.ok(solRingItem);
    return database.wishlistPriceHistory.filter((point) => point.resolvedIdentityKey === solRingItem.resolvedIdentityKey).length;
  });

  const firstRefresh = await refreshDeckWishlistPricing(1, "/api/decks/1/wishlist/refresh", 2);
  assert.equal("status" in firstRefresh, false);
  assert.ok(firstRefresh.refreshedItems >= 0);

  const firstCount = await withDatabaseWrite((database) => {
    const solRingItem = database.wishlistItems.find((item) => item.deckId === 1 && item.scryfallId === "sol-ring-id");
    assert.ok(solRingItem);
    return database.wishlistPriceHistory.filter((point) => point.resolvedIdentityKey === solRingItem.resolvedIdentityKey).length;
  });
  assert.ok(firstCount >= before);

  const secondRefresh = await refreshDeckWishlistPricing(1, "/api/decks/1/wishlist/refresh", 2);
  assert.equal("status" in secondRefresh, false);
  assert.equal(secondRefresh.refreshedItems, 0);

  const secondCount = await withDatabaseWrite((database) => {
    const solRingItem = database.wishlistItems.find((item) => item.deckId === 1 && item.scryfallId === "sol-ring-id");
    assert.ok(solRingItem);
    return database.wishlistPriceHistory.filter((point) => point.resolvedIdentityKey === solRingItem.resolvedIdentityKey).length;
  });
  assert.equal(secondCount, firstCount);
});

await runTest("purchase validation blocks invalid quantity, precision, and future date", async () => {
  const wishlist = await listDeckWishlist(1, "best-opportunity", "/api/decks/1/wishlist", 2);
  assert.equal("status" in wishlist, false);
  const solRing = wishlist.items.find((item) => item.cardName === "Sol Ring");
  assert.ok(solRing);

  const badQuantity = await createDeckWishlistPurchase(1, {
    wishlistItemId: solRing.id,
    quantity: 1000,
    unitPriceUsd: 1
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in badQuantity, true);
  assert.equal(badQuantity.status, 400);

  const badPrecision = await createDeckWishlistPurchase(1, {
    wishlistItemId: solRing.id,
    quantity: 1,
    unitPriceUsd: 1.239
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in badPrecision, true);
  assert.equal(badPrecision.status, 400);

  const futureDate = await createDeckWishlistPurchase(1, {
    wishlistItemId: solRing.id,
    quantity: 1,
    unitPriceUsd: 1.2,
    purchasedAt: "2099-01-01"
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in futureDate, true);
  assert.equal(futureDate.status, 400);
});

await runTest("global buy opportunities include only owned decks with deterministic best-opportunity sorting", async () => {
  await withDatabaseWrite((database) => {
    database.decks.push({
      id: 2,
      ownerUserId: 3,
      name: "Foreign Deck",
      format: "Commander",
      commander: "Rhystic Study",
      createdAt: "2026-04-05T12:00:00.000Z"
    });

    database.wishlistItems.push({
      id: database.nextWishlistItemId++,
      ownerUserId: 3,
      deckId: 2,
      cardName: "Foreign Card",
      scryfallId: "foreign-card-id",
      resolvedIdentityKey: "id:foreign-card-id",
      targetQuantity: 1,
      createdAt: "2026-04-05T12:00:00.000Z",
      updatedAt: "2026-04-05T12:00:00.000Z"
    });
    database.nextDeckId = 3;
  });

  const result = await listBuyOpportunities({ sort: "best-opportunity" }, "/api/buy-opportunities", 2);
  assert.equal("status" in result, false);
  assert.equal(result.items.some((item) => item.deckName === "Foreign Deck"), false);
  assert.ok(result.items.length > 0);

  const tied = result.items.filter((item) => item.cardName === "Tie Card");
  assert.equal(tied.length, 2);
  assert.ok(tied[0].wishlistItemId < tied[1].wishlistItemId);
});

await runTest("global buy opportunities filters combine correctly", async () => {
  const discounted = await listBuyOpportunities({
    sort: "highest-discount",
    signal: "good-moment",
    historyStatus: "available"
  }, "/api/buy-opportunities", 2);
  assert.equal("status" in discounted, false);
  assert.ok(discounted.items.length >= 1);
  assert.ok(discounted.items.every((item) => item.pricing.signal === "good-moment"));
  assert.ok(discounted.items.every((item) => item.pricing.historyStatus === "available"));

  const deckFiltered = await listBuyOpportunities({
    sort: "deck-name",
    deckId: 1
  }, "/api/buy-opportunities", 2);
  assert.equal("status" in deckFiltered, false);
  assert.ok(deckFiltered.items.every((item) => item.deckId === 1));
});

await runTest("collector overview aggregates purchases across owned decks with weighted cost basis", async () => {
  await withDatabaseWrite((database) => {
    database.decks.push({
      id: 3,
      ownerUserId: 2,
      name: "Second Owned Deck",
      format: "Commander",
      commander: "Sol Ring",
      createdAt: "2026-04-06T09:00:00.000Z"
    });
    database.nextDeckId = 4;

    database.wishlistItems.push({
      id: database.nextWishlistItemId++,
      ownerUserId: 2,
      deckId: 3,
      cardName: "Sol Ring",
      scryfallId: "sol-ring-id",
      resolvedIdentityKey: "id:sol-ring-id",
      targetQuantity: 1,
      createdAt: "2026-04-06T09:00:00.000Z",
      updatedAt: "2026-04-06T09:00:00.000Z"
    });
  });

  const secondDeckWishlist = await listDeckWishlist(3, "best-opportunity", "/api/decks/3/wishlist", 2);
  assert.equal("status" in secondDeckWishlist, false);
  const solRingSecond = secondDeckWishlist.items.find((item) => item.cardName === "Sol Ring");
  assert.ok(solRingSecond);

  const secondDeckPurchase = await createDeckWishlistPurchase(3, {
    wishlistItemId: solRingSecond.id,
    quantity: 2,
    unitPriceUsd: 7.5,
    purchasedAt: "2026-04-06"
  }, "/api/decks/3/purchases", 2);
  assert.equal("status" in secondDeckPurchase, false);

  const overview = await listCollectorOverview({ sort: "latest-purchase" }, "/api/collector-overview", 2);
  assert.equal("status" in overview, false);
  const solRing = overview.items.find((item) => item.resolvedIdentityKey === "id:sol-ring-id");
  assert.ok(solRing);
  assert.ok(solRing.decks.some((deck) => deck.id === 1));
  assert.ok(solRing.decks.some((deck) => deck.id === 3));
  assert.equal(solRing.totalPurchasedQuantity, 3);
  assert.equal(solRing.totalCostUsd, 24);
  assert.equal(solRing.averageCostBasisUsd, 8);
  assert.equal(solRing.currentUnitPriceUsd, 1.5);
  assert.equal(solRing.currentTotalValueUsd, 4.5);
  assert.equal(solRing.deltaUsd, -19.5);
  assert.equal(solRing.deltaPercent, -81.25);
});

await runTest("collector overview filters and deterministic sorting work", async () => {
  const profitableOnly = await listCollectorOverview({
    sort: "biggest-gain",
    profitability: "profitable"
  }, "/api/collector-overview", 2);
  assert.equal("status" in profitableOnly, false);
  assert.ok(profitableOnly.items.every((item) => (item.deltaUsd ?? 0) > 0));

  const limitedOnly = await listCollectorOverview({
    sort: "card-name",
    priceData: "limited-or-unavailable"
  }, "/api/collector-overview", 2);
  assert.equal("status" in limitedOnly, false);
  assert.ok(limitedOnly.items.every((item) => item.priceDataStatus !== "available"));

  const deckFiltered = await listCollectorOverview({
    sort: "latest-purchase",
    deckId: 3
  }, "/api/collector-overview", 2);
  assert.equal("status" in deckFiltered, false);
  assert.ok(deckFiltered.items.every((item) => item.decks.some((deck) => deck.id === 3)));

  const byLatest = await listCollectorOverview({
    sort: "latest-purchase"
  }, "/api/collector-overview", 2);
  assert.equal("status" in byLatest, false);
  for (let index = 1; index < byLatest.items.length; index += 1) {
    const prev = new Date(byLatest.items[index - 1].latestPurchaseAt ?? 0).getTime();
    const next = new Date(byLatest.items[index].latestPurchaseAt ?? 0).getTime();
    assert.ok(prev >= next);
  }
});

await runTest("collector overview latest-purchase sorting stays deterministic on equal timestamps", async () => {
  await withDatabaseWrite((database) => {
    database.wishlistItems.push(
      {
        id: database.nextWishlistItemId++,
        ownerUserId: 2,
        deckId: 1,
        cardName: "Alpha Tie",
        scryfallId: "alpha-tie-id",
        resolvedIdentityKey: "id:alpha-tie-id",
        targetQuantity: 1,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z"
      },
      {
        id: database.nextWishlistItemId++,
        ownerUserId: 2,
        deckId: 1,
        cardName: "Beta Tie",
        scryfallId: "beta-tie-id",
        resolvedIdentityKey: "id:beta-tie-id",
        targetQuantity: 1,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z"
      }
    );
  });

  const baseWishlist = await listDeckWishlist(1, "name", "/api/decks/1/wishlist", 2);
  assert.equal("status" in baseWishlist, false);
  const alpha = baseWishlist.items.find((item) => item.cardName === "Alpha Tie");
  const beta = baseWishlist.items.find((item) => item.cardName === "Beta Tie");
  assert.ok(alpha);
  assert.ok(beta);

  const tieDate = "2026-04-01T11:00:00.000Z";
  const alphaPurchase = await createDeckWishlistPurchase(1, {
    wishlistItemId: alpha.id,
    quantity: 1,
    unitPriceUsd: 2,
    purchasedAt: tieDate
  }, "/api/decks/1/purchases", 2);
  const betaPurchase = await createDeckWishlistPurchase(1, {
    wishlistItemId: beta.id,
    quantity: 1,
    unitPriceUsd: 2,
    purchasedAt: tieDate
  }, "/api/decks/1/purchases", 2);
  assert.equal("status" in alphaPurchase, false);
  assert.equal("status" in betaPurchase, false);

  const overview = await listCollectorOverview({ sort: "latest-purchase" }, "/api/collector-overview", 2);
  assert.equal("status" in overview, false);
  const tieRows = overview.items.filter((item) => item.cardName === "Alpha Tie" || item.cardName === "Beta Tie");
  assert.equal(tieRows.length, 2);
  assert.equal(tieRows[0]?.cardName, "Alpha Tie");
  assert.equal(tieRows[1]?.cardName, "Beta Tie");
});

await runTest("card detail aggregates pricing, history, deck usage, wishlist usage, and purchases", async () => {
  const result = await getCardDetail("id:sol-ring-id", "/api/cards/id:sol-ring-id", 2);
  assert.equal("status" in result, false);
  assert.equal(result.scryfallId, "sol-ring-id");
  assert.equal(result.cardName, "Sol Ring");
  assert.ok(result.decks.length >= 1);
  assert.ok(result.wishlistDecks.length >= 1);
  assert.ok(result.history.length >= 1);
  assert.ok(result.purchases.length >= 1);
  assert.equal(result.costBasis.totalPurchasedQuantity >= 1, true);
  assert.equal(result.pricing.signal, "good-moment");
});

await runTest("card detail ownership is enforced", async () => {
  const forbidden = await getCardDetail("id:sol-ring-id", "/api/cards/id:sol-ring-id", 3);
  assert.equal("status" in forbidden, true);
  assert.equal(forbidden.status, 404);
});

await runTest("currency conversion helpers keep canonical USD and provide stable EUR display", async () => {
  const usd = 10;
  const eur = convertCurrencyAmount(usd, "EUR", "USD");
  assert.ok(eur != null);
  assert.ok(eur > 0);

  const roundTripUsd = convertCurrencyAmount(eur, "USD", "EUR");
  assert.ok(roundTripUsd != null);
  assert.ok(Math.abs(roundTripUsd - usd) < 0.0001);
});

await runTest("freshness labels expose recent vs stale vs missing data states", async () => {
  const nowIso = new Date().toISOString();
  const oldIso = new Date(Date.now() - (1000 * 60 * 60 * 30)).toISOString();
  assert.equal(freshnessLabel(nowIso), "Dato reciente");
  assert.equal(freshnessLabel(oldIso), "Dato antiguo");
  assert.equal(freshnessLabel(null), "Sin dato reciente");
});

console.log("All deck wishlist buy-signal tests passed.");
