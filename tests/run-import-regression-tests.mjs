import assert from "node:assert/strict";

import { buildLookupCandidates, inferCommanderFromResolvedEntries, parseDecklistText } from "../lib/decklist-import.ts";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const punctuationNames = [
  "Tajic, Legion's Edge",
  "Gisa's Favorite Shovel",
  "Kaya's Wrath",
  "Alesha, Who Smiles at Death",
  "Wear // Tear",
  "Beseech the Mirror",
  "Rogue's Passage",
  "Sevinne's Reclamation",
  "Krenko, Tin Street Kingpin",
  "Teferi's Protection",
  "Command Tower",
  "Arcane Signet",
  "Swords to Plowshares",
  "Path to Exile",
  "Eiganjo, Seat of the Empire"
];

const fillerNames = Array.from({ length: 62 }, (_, index) => `Sample Relic ${index + 1}`);
const commanderName = "Atraxa, Praetors' Voice";
const decklistLines = [
  ...punctuationNames,
  ...fillerNames,
  "8 Mountain",
  "7 Plains",
  "7 Forest",
  commanderName
];
const decklistText = decklistLines.join("\n");

runTest("simple parser recognizes bare one-card-per-line commander lists", () => {
  const preview = parseDecklistText(decklistText);

  assert.equal(preview.unrecognizedLines.length, 0);
  assert.equal(preview.recognizedEntries.length, decklistLines.length);
  assert.equal(preview.recognizedEntries.reduce((total, entry) => total + entry.quantity, 0), 100);
});

runTest("simple parser keeps punctuation-heavy names intact", () => {
  const preview = parseDecklistText(decklistText);

  assert.ok(preview.recognizedEntries.some((entry) => entry.name === "Tajic, Legion's Edge"));
  assert.ok(preview.recognizedEntries.some((entry) => entry.name === "Gisa's Favorite Shovel"));
  assert.ok(preview.recognizedEntries.some((entry) => entry.name === "Wear // Tear"));
});

runTest("lookup candidates strip common export metadata without over-normalizing card names", () => {
  assert.deepEqual(buildLookupCandidates("Atraxa, Praetors' Voice (2XM) 190"), [
    "Atraxa, Praetors' Voice (2XM) 190",
    "Atraxa, Praetors' Voice"
  ]);
  assert.deepEqual(buildLookupCandidates("Lightning Bolt [STA]"), [
    "Lightning Bolt [STA]",
    "Lightning Bolt"
  ]);
  assert.deepEqual(buildLookupCandidates("Teferi's Protection"), [
    "Teferi's Protection"
  ]);
});

runTest("commander inference can use the final valid commander entry", () => {
  const preview = parseDecklistText(decklistText);
  const inference = inferCommanderFromResolvedEntries(
    "Commander",
    preview.commanderEntries,
    preview.recognizedEntries.map((entry) => ({
      name: entry.name,
      originalName: entry.name,
      quantity: entry.quantity,
      type: entry.name === commanderName ? "Legendary Creature — Phyrexian Angel" : (entry.name.includes("Mountain") || entry.name.includes("Plains") || entry.name.includes("Forest") ? "Land" : "Artifact")
    }))
  );

  assert.equal(inference.commanderName, commanderName);
  assert.match(inference.detection, /ultima carta valida/i);
});

console.log("All import regression tests passed.");
