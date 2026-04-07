import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.MTG_DB_PATH = path.join(os.tmpdir(), `mtg-deck-delete-${Date.now()}.sqlite`);

const { withDatabaseWrite } = await import("../lib/server/mtg-store.ts");
const { deleteDeck } = await import("../lib/server/mtg-domain.ts");

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

await withDatabaseWrite((database) => {
  database.users.push(
    {
      id: 101,
      email: "owner-delete@test.local",
      passwordHash: "hash",
      createdAt: "2026-04-06T12:00:00.000Z",
      isBootstrapLegacyOwner: false,
      authProvider: "local",
      googleSubject: null,
      emailVerified: true,
      emailVerifiedAt: "2026-04-06T12:00:00.000Z",
      preferredDisplayCurrency: "USD",
      showPriceFreshness: true
    },
    {
      id: 102,
      email: "other-delete@test.local",
      passwordHash: "hash",
      createdAt: "2026-04-06T12:00:00.000Z",
      isBootstrapLegacyOwner: false,
      authProvider: "local",
      googleSubject: null,
      emailVerified: true,
      emailVerifiedAt: "2026-04-06T12:00:00.000Z",
      preferredDisplayCurrency: "USD",
      showPriceFreshness: true
    }
  );
  database.nextUserId = 103;

  database.decks.push({
    id: 1,
    ownerUserId: 101,
    name: "Delete Me",
    format: "Commander",
    commander: "Sol Ring",
    createdAt: "2026-04-06T12:00:00.000Z"
  });
  database.nextDeckId = 2;

  database.cards.push({
    id: 1,
    deckId: 1,
    name: "Sol Ring",
    manaValue: 1,
    type: "Artifact",
    colors: "Colorless",
    quantity: 1,
    scryfallId: "sol-ring-id",
    imageSmall: null,
    imageNormal: null,
    imageUrl: null
  });
  database.nextCardId = 2;

  database.wishlistItems.push({
    id: 1,
    ownerUserId: 101,
    deckId: 1,
    cardName: "Rhystic Study",
    scryfallId: "rhystic-study-id",
    resolvedIdentityKey: "id:rhystic-study-id",
    targetQuantity: 1,
    createdAt: "2026-04-06T12:00:00.000Z",
    updatedAt: "2026-04-06T12:00:00.000Z"
  });
  database.nextWishlistItemId = 2;

  database.deckCardPurchases.push({
    id: 1,
    ownerUserId: 101,
    deckId: 1,
    wishlistItemId: 1,
    resolvedIdentityKey: "id:rhystic-study-id",
    cardName: "Rhystic Study",
    scryfallId: "rhystic-study-id",
    quantity: 1,
    unitPriceUsd: 20,
    purchasedAt: "2026-04-06T12:00:00.000Z",
    createdAt: "2026-04-06T12:00:00.000Z"
  });
  database.nextDeckCardPurchaseId = 2;

  database.deckValueSnapshots.push({
    id: 1,
    deckId: 1,
    snapshotKind: "current",
    source: "test",
    snapshotAt: "2026-04-06T12:00:00.000Z",
    currency: "USD",
    totalValue: 10,
    pricedCardCount: 1,
    missingPriceCardCount: 0,
    note: null
  });
  database.nextDeckValueSnapshotId = 2;

  database.cardValueSnapshots.push({
    id: 1,
    deckSnapshotId: 1,
    deckId: 1,
    cardId: 1,
    cardName: "Sol Ring",
    quantity: 1,
    scryfallId: "sol-ring-id",
    imageUrl: null,
    currency: "USD",
    unitPrice: 10,
    totalValue: 10,
    status: "priced"
  });
  database.nextCardValueSnapshotId = 2;
});

await runTest("deck delete rejects non-owner access", async () => {
  const result = await deleteDeck(1, "/api/decks/1", 102);
  assert.equal(typeof result, "object");
  assert.equal("status" in result, true);
  assert.equal(result.status, 404);
});

await runTest("deck delete removes deck and deck-bound dependent records", async () => {
  const result = await deleteDeck(1, "/api/decks/1", 101);
  assert.equal(result, null);

  await withDatabaseWrite((database) => {
    assert.equal(database.decks.some((deck) => deck.id === 1), false);
    assert.equal(database.cards.some((card) => card.deckId === 1), false);
    assert.equal(database.wishlistItems.some((item) => item.deckId === 1), false);
    assert.equal(database.deckCardPurchases.some((purchase) => purchase.deckId === 1), false);
    assert.equal(database.deckValueSnapshots.some((snapshot) => snapshot.deckId === 1), false);
    assert.equal(database.cardValueSnapshots.some((snapshot) => snapshot.deckId === 1), false);
  });
});

console.log("All deck delete tests passed.");
