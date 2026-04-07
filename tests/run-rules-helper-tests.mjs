import assert from "node:assert/strict";
import { parseInteractionPair, resolveRulesHelperQuery } from "../lib/server/rules-helper.ts";

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

await runTest("interaction parser supports standard between format", async () => {
  const pair = parseInteractionPair("interaction between Rhystic Study and Smothering Tithe");
  assert.ok(pair);
  assert.equal(pair.left, "Rhystic Study");
  assert.equal(pair.right, "Smothering Tithe");
});

await runTest("rules query returns compact rules response without deck context", async () => {
  const result = await resolveRulesHelperQuery("does ward use the stack?");
  assert.equal(result.intent, "rules");
  assert.equal(result.title.toLowerCase(), "ward");
  assert.ok(result.shortAnswer.length > 0);
  assert.ok(result.note.toLowerCase().includes("reglas"));
  assert.equal(result.cards.length, 0);
});

await runTest("blank query fails validation with clear message", async () => {
  await assert.rejects(
    () => resolveRulesHelperQuery(" "),
    /Escribe una consulta corta/
  );
});

console.log("All rules helper tests passed.");
