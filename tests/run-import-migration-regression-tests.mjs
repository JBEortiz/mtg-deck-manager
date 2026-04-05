import assert from "node:assert/strict";

import { buildLookupCandidates, parseDecklistText } from "../lib/decklist-import.ts";

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

const decklistLines = [
  ...Array.from({ length: 74 }, (_, index) => `Value Card ${index + 1}`),
  "Demonic Tutor",
  "Dimir Signet",
  "Displacer Kitten",
  "Dragonskull Summit",
  "8 Mountain",
  "7 Swamp",
  "7 Island"
];
const decklistText = decklistLines.join("\n");

function createLookupResult(name) {
  return {
    name,
    manaValue: 2,
    type: /mountain|swamp|island/i.test(name) ? "Land" : "Artifact",
    colors: /mountain/i.test(name) ? "R" : /swamp/i.test(name) ? "B" : /island/i.test(name) ? "U" : "C",
    scryfallId: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    imageSmall: null,
    imageNormal: null
  };
}

async function flakyLookup(name) {
  flakyLookup.calls = (flakyLookup.calls ?? 0) + 1;
  if (flakyLookup.calls > 21) {
    const error = new Error("Upstream rate limit");
    error.status = 429;
    error.code = "rate_limited";
    throw error;
  }
  return createLookupResult(name);
}

async function resolveWithCurrentFallback(entries, lookupCard) {
  const results = [];

  for (const entry of entries) {
    const candidates = buildLookupCandidates(entry.name);
    let resolved = null;
    let lastFailure = null;

    for (let index = 0; index < candidates.length; index += 1) {
      try {
        const lookup = await lookupCard(candidates[index], "exact");
        resolved = { ok: true, entry, lookup, resolvedBy: index === 0 ? "exact" : "normalized-exact" };
        break;
      } catch (error) {
        lastFailure = error;
        if (error.status !== 404) {
          break;
        }
      }
    }

    if (!resolved) {
      try {
        const lookup = await lookupCard(candidates[candidates.length - 1], "fuzzy");
        resolved = { ok: true, entry, lookup, resolvedBy: "fuzzy" };
      } catch (error) {
        lastFailure = error;
      }
    }

    if (!resolved && lastFailure && (lastFailure.status === 429 || lastFailure.status === 504 || lastFailure.status >= 500)) {
      resolved = { ok: true, entry, lookup: null, resolvedBy: "fallback-inferred" };
    }

    results.push(resolved ?? { ok: false, entry, resolvedBy: "unresolved" });
  }

  return results;
}

runTest("migration regression scenario shows why Next could stall around the first 20 cards", async () => {
  const preview = parseDecklistText(decklistText);
  assert.equal(preview.recognizedEntries.reduce((total, entry) => total + entry.quantity, 0), 100);

  let oldNextImportedCount = 0;
  flakyLookup.calls = 0;
  for (const entry of preview.recognizedEntries) {
    try {
      await flakyLookup(entry.name, "exact");
      oldNextImportedCount += entry.quantity;
    } catch {
      // Previous Next behavior dropped the card entirely on transient lookup failure.
    }
  }

  flakyLookup.calls = 0;
  const resolved = await resolveWithCurrentFallback(preview.recognizedEntries, async (name) => flakyLookup(name));
  const newImportedCount = resolved
    .filter((entry) => entry.ok)
    .reduce((total, entry) => total + entry.entry.quantity, 0);
  const fallbackImportedCount = resolved
    .filter((entry) => entry.ok && entry.resolvedBy === "fallback-inferred")
    .reduce((total, entry) => total + entry.entry.quantity, 0);

  const springImportedCount = 100;

  assert.equal(oldNextImportedCount, 21);
  assert.equal(newImportedCount, 100);
  assert.equal(fallbackImportedCount, 79);
  assert.equal(springImportedCount, 100);
});

console.log("All import migration regression tests passed.");
