import assert from "node:assert/strict";

import {
  createOwnedDeckRecord,
  ensureOwnedResource,
  filterOwnedResources,
  requireAuthenticatedOwner
} from "../lib/server/deck-ownership.ts";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("unauthenticated protected API access resolves to 401", () => {
  const result = requireAuthenticatedOwner();

  assert.equal(typeof result, "object");
  assert.equal(result.status, 401);
  assert.equal(result.body.message, "Debes iniciar sesion.");
});

runTest("authenticated deck list returns only owned decks", () => {
  const decks = [
    { id: 1, ownerUserId: 100, name: "Owner A" },
    { id: 2, ownerUserId: 200, name: "Owner B" },
    { id: 3, ownerUserId: 100, name: "Owner A 2" }
  ];

  const result = filterOwnedResources(decks, 100);

  assert.deepEqual(result.map((deck) => deck.id), [1, 3]);
});

runTest("authenticated access to another user's deck resolves to 404", () => {
  const result = ensureOwnedResource(
    { id: 9, ownerUserId: 200, name: "Other deck" },
    100,
    "/api/decks/9"
  );

  assert.equal(typeof result, "object");
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "Not Found");
  assert.equal(result.body.path, "/api/decks/9");
});

runTest("deck creation attaches the authenticated owner", () => {
  const deck = createOwnedDeckRecord({
    id: 12,
    ownerUserId: 777,
    name: "My Deck",
    format: "commander",
    commander: "Atraxa, Praetors' Voice",
    createdAt: "2026-04-05T12:00:00.000Z"
  });

  assert.equal(deck.ownerUserId, 777);
  assert.equal(deck.id, 12);
  assert.equal(deck.name, "My Deck");
});

console.log("All deck ownership policy tests passed.");
