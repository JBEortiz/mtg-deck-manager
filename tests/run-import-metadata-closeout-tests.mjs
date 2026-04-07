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

process.env.MTG_DB_PATH = path.join(os.tmpdir(), `mtg-import-metadata-closeout-${Date.now()}.sqlite`);

let fallbackNames = new Set([
  "Magda, Brazen Outlaw",
  "Dockside Extortionist",
  "Goldspan Dragon",
  "Chaos Warp"
]);

let lookupMode = "degraded";

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function createCard(name, manaValue, typeLine, colors) {
  return {
    id: `${slugify(name)}-id`,
    name,
    cmc: manaValue,
    type_line: typeLine,
    colors,
    image_uris: {
      small: `https://img.test/${encodeURIComponent(name)}/small.jpg`,
      normal: `https://img.test/${encodeURIComponent(name)}/normal.jpg`
    }
  };
}

const cardCatalog = new Map([
  ["Magda, Brazen Outlaw", createCard("Magda, Brazen Outlaw", 2, "Legendary Creature - Dwarf Berserker", ["R"])],
  ["Sol Ring", createCard("Sol Ring", 1, "Artifact", [])],
  ["Arcane Signet", createCard("Arcane Signet", 2, "Artifact", [])],
  ["Dockside Extortionist", createCard("Dockside Extortionist", 2, "Creature - Goblin Pirate", ["R"])],
  ["Captain Lannery Storm", createCard("Captain Lannery Storm", 3, "Legendary Creature - Human Pirate", ["R"])],
  ["Goldspan Dragon", createCard("Goldspan Dragon", 5, "Creature - Dragon", ["R"])],
  ["Reckless Fireweaver", createCard("Reckless Fireweaver", 2, "Creature - Human Artificer", ["R"])],
  ["Lightning Bolt", createCard("Lightning Bolt", 1, "Instant", ["R"])],
  ["Abrade", createCard("Abrade", 2, "Instant", ["R"])],
  ["Chaos Warp", createCard("Chaos Warp", 3, "Instant", ["R"])],
  ["Mind Stone", createCard("Mind Stone", 2, "Artifact", [])],
  ["Xorn", createCard("Xorn", 3, "Creature - Elemental", ["R"])],
  ["Unexpected Windfall", createCard("Unexpected Windfall", 4, "Instant", ["R"])],
  ["Mountain", createCard("Mountain", 0, "Basic Land - Mountain", ["R"])],
  ["Swamp", createCard("Swamp", 0, "Basic Land - Swamp", ["B"])]
]);

const STRESS_COMMANDER_NAME = "Fallback Commander Alpha";
const STRESS_CARD_NAMES = Array.from({ length: 99 }, (_, index) => `Fallback Sample Card ${index + 1}`);

cardCatalog.set(STRESS_COMMANDER_NAME, createCard(STRESS_COMMANDER_NAME, 3, "Legendary Creature - Goblin Artificer", ["R"]));
for (const [index, name] of STRESS_CARD_NAMES.entries()) {
  cardCatalog.set(name, createCard(name, (index % 5) + 1, "Creature - Goblin Artificer", ["R"]));
}

global.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (!url.hostname.includes("api.scryfall.com")) {
    throw new Error(`Unexpected URL ${url.toString()}`);
  }

  if (url.pathname !== "/cards/named") {
    throw new Error(`Unhandled Scryfall path ${url.pathname}`);
  }

  const name = url.searchParams.get("exact") ?? url.searchParams.get("fuzzy");
  if (!name) {
    return new Response(JSON.stringify({ details: "Missing card name" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (lookupMode === "degraded" && fallbackNames.has(name)) {
    return new Response(JSON.stringify({ details: "Rate limit during validation" }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    });
  }

  const card = cardCatalog.get(name);
  if (!card) {
    return new Response(JSON.stringify({ details: "Card not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify(card), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const { withDatabaseWrite, readDatabase } = await import("../lib/server/mtg-store.ts");
const { getDeck, importDecklist, listDeckCards, listDecks } = await import("../lib/server/mtg-domain.ts");

await withDatabaseWrite((database) => {
  database.users.push({
    id: 2,
    email: "import-closeout@test.local",
    passwordHash: "hash",
    createdAt: "2026-04-05T12:00:00.000Z",
    isBootstrapLegacyOwner: false,
    preferredDisplayCurrency: "USD",
    showPriceFreshness: true
  });
  database.nextUserId = 3;
  database.decks.push({
    id: 1,
    ownerUserId: 2,
    name: "Import Closeout",
    format: "Commander",
    commander: "",
    createdAt: "2026-04-05T12:00:00.000Z"
  });
  database.decks.push({
    id: 2,
    ownerUserId: 2,
    name: "Import Unresolved",
    format: "Commander",
    commander: "",
    createdAt: "2026-04-05T12:05:00.000Z"
  });
  database.decks.push({
    id: 3,
    ownerUserId: 2,
    name: "Import Stress Recovery",
    format: "Commander",
    commander: "",
    createdAt: "2026-04-05T12:10:00.000Z"
  });
  database.nextDeckId = 4;
});

await runTest("fallback-imported cards recover metadata, commander detection, and deck cover", async () => {
  const decklistText = [
    "Commander",
    "1 Magda, Brazen Outlaw",
    "",
    "Deck",
    "1 Sol Ring",
    "1 Arcane Signet",
    "1 Dockside Extortionist",
    "1 Captain Lannery Storm",
    "1 Goldspan Dragon",
    "1 Reckless Fireweaver",
    "1 Lightning Bolt",
    "1 Abrade",
    "1 Chaos Warp",
    "1 Mind Stone",
    "1 Xorn",
    "1 Unexpected Windfall",
    "43 Mountain",
    "44 Swamp"
  ].join("\n");

  const importResult = await importDecklist(1, { decklistText }, "/api/decks/1/import", 2);
  assert.equal("status" in importResult && typeof importResult.status === "number", false);
  assert.equal(importResult.importedCount, 100);
  assert.equal(importResult.errors.length, 0);
  assert.equal(importResult.pipeline.fallbackImportedCards, 4);
  assert.match(importResult.pipeline.commanderDetection, /seccion de comandante/i);

  let persisted = await readDatabase();
  const brokenNames = ["Magda, Brazen Outlaw", "Dockside Extortionist", "Goldspan Dragon", "Chaos Warp"];
  for (const name of brokenNames) {
    const rawCard = persisted.cards.find((card) => card.deckId === 1 && card.name === name);
    assert.ok(rawCard, `Expected raw fallback-imported card ${name}`);
    assert.equal(rawCard.type, "Unknown");
    assert.equal(rawCard.colors, "Colorless");
    assert.equal(rawCard.manaValue, 0);
    assert.equal(rawCard.scryfallId, null);
    assert.equal(rawCard.imageNormal, null);
    assert.equal(rawCard.imageSmall, null);
    assert.equal(rawCard.imageUrl, null);
  }

  lookupMode = "healthy";

  const listedDecks = await listDecks(2);
  const listedDeck = listedDecks.find((deck) => deck.id === 1);
  assert.ok(listedDeck, "Expected imported deck in deck list");
  assert.ok(listedDeck.deckCoverUrl, "Expected commander cover in deck list");
  assert.match(listedDeck.deckCoverUrl, /Magda%2C%20Brazen%20Outlaw/);

  const deck = await getDeck(1, "/api/decks/1", 2);
  assert.equal("status" in deck && typeof deck.status === "number", false);
  assert.equal(deck.commander, "Magda, Brazen Outlaw");
  assert.ok(deck.deckCoverUrl, "Expected commander cover on deck detail response");
  assert.match(deck.deckCoverUrl, /Magda%2C%20Brazen%20Outlaw/);

  const cards = await listDeckCards(1, new URLSearchParams(), "/api/decks/1", 2);
  assert.equal("status" in cards && typeof cards.status === "number", false);
  assert.equal(cards.length, 15);
  assert.equal(cards.some((card) => card.type === "Unknown"), false);
  assert.equal(cards.some((card) => card.manaValue === 0 && !card.type.toLowerCase().includes("land")), false);
  assert.equal(cards.some((card) => !card.imageNormal && !card.imageSmall && !card.imageUrl), false);

  for (const name of brokenNames) {
    const repairedCard = cards.find((card) => card.name === name);
    assert.ok(repairedCard, `Expected repaired card ${name}`);
    assert.notEqual(repairedCard.type, "Unknown");
    assert.notEqual(repairedCard.colors, "Colorless");
    assert.notEqual(repairedCard.colors, "C");
    assert.ok(repairedCard.manaValue > 0);
    assert.ok(repairedCard.scryfallId);
    assert.ok(repairedCard.imageNormal || repairedCard.imageSmall || repairedCard.imageUrl);
  }

  persisted = await readDatabase();
  for (const name of brokenNames) {
    const repairedRawCard = persisted.cards.find((card) => card.deckId === 1 && card.name === name);
    assert.ok(repairedRawCard, `Expected persisted repaired card ${name}`);
    assert.notEqual(repairedRawCard.type, "Unknown");
    assert.notEqual(repairedRawCard.colors, "Colorless");
    assert.ok(repairedRawCard.manaValue > 0);
    assert.ok(repairedRawCard.scryfallId);
    assert.ok(repairedRawCard.imageNormal || repairedRawCard.imageSmall || repairedRawCard.imageUrl);
  }
});

await runTest("large fallback-heavy imports recover metadata for every pending card in one read", async () => {
  fallbackNames = new Set([STRESS_COMMANDER_NAME, ...STRESS_CARD_NAMES]);
  lookupMode = "degraded";

  const decklistText = [
    "Commander",
    `1 ${STRESS_COMMANDER_NAME}`,
    "",
    "Deck",
    ...STRESS_CARD_NAMES.map((name) => `1 ${name}`)
  ].join("\n");

  const importResult = await importDecklist(3, { decklistText }, "/api/decks/3/import", 2);
  assert.equal("status" in importResult && typeof importResult.status === "number", false);
  assert.equal(importResult.importedCount, 100);
  assert.equal(importResult.errors.length, 0);
  assert.equal(importResult.pipeline.fallbackImportedCards, 100);
  assert.match(importResult.pipeline.commanderDetection, /seccion de comandante/i);

  let persisted = await readDatabase();
  const pendingBeforeRecovery = persisted.cards
    .filter((card) => card.deckId === 3)
    .filter((card) => card.type === "Unknown" || card.colors === "Colorless" || card.manaValue === 0)
    .length;
  assert.equal(pendingBeforeRecovery, 100);

  lookupMode = "healthy";

  const deck = await getDeck(3, "/api/decks/3", 2);
  assert.equal("status" in deck && typeof deck.status === "number", false);
  assert.equal(deck.commander, STRESS_COMMANDER_NAME);
  assert.ok(deck.deckCoverUrl, "Expected commander cover after recovery");
  assert.ok(deck.deckCoverUrl.includes(encodeURIComponent(STRESS_COMMANDER_NAME)));

  const cards = await listDeckCards(3, new URLSearchParams(), "/api/decks/3", 2);
  assert.equal("status" in cards && typeof cards.status === "number", false);
  assert.equal(cards.length, 100);
  assert.equal(cards.some((card) => card.type === "Unknown"), false);
  assert.equal(cards.some((card) => card.colors === "Colorless" || card.colors === "C"), false);
  assert.equal(cards.some((card) => card.manaValue === 0), false);
  assert.equal(cards.some((card) => !card.imageNormal && !card.imageSmall && !card.imageUrl), false);

  persisted = await readDatabase();
  const pendingAfterRecovery = persisted.cards
    .filter((card) => card.deckId === 3)
    .filter((card) => card.type === "Unknown" || card.colors === "Colorless" || card.manaValue === 0 || (!card.imageNormal && !card.imageSmall && !card.imageUrl))
    .length;
  assert.equal(pendingAfterRecovery, 0);
});

await runTest("truly unresolved card names stay unresolved instead of creating bogus rows", async () => {
  lookupMode = "healthy";

  const decklistText = [
    "Commander",
    "1 Magda, Brazen Outlaw",
    "",
    "Deck",
    "98 Mountain",
    "1 Totally Made Up Card"
  ].join("\n");

  const importResult = await importDecklist(2, { decklistText }, "/api/decks/2/import", 2);
  assert.equal("status" in importResult && typeof importResult.status === "number", false);
  assert.equal(importResult.importedCount, 99);
  assert.equal(importResult.errors.length, 1);
  assert.match(importResult.errors[0]?.message ?? "", /not found/i);

  const cards = await listDeckCards(2, new URLSearchParams(), "/api/decks/2", 2);
  assert.equal("status" in cards && typeof cards.status === "number", false);
  assert.equal(cards.some((card) => card.name === "Totally Made Up Card"), false);
});

console.log("All import metadata closeout tests passed.");
