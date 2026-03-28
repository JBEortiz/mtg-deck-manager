import { searchCardsForAssistant } from "./rules/cardSearch.js";
const q1 = await searchCardsForAssistant("white removal mana value 2");
const q2 = await searchCardsForAssistant("green creatures with reach");
const q3 = await searchCardsForAssistant("artifact ramp cost 2");
if (q1.matches.length === 0 || q2.matches.length === 0 || q3.matches.length === 0) {
  console.log(`STEP3_CARD_FAIL q1=${q1.matches.length} q2=${q2.matches.length} q3=${q3.matches.length}`);
  process.exit(2);
}
console.log(`STEP3_CARD_OK q1=${q1.matches[0].card.name} q2=${q2.matches[0].card.name} q3=${q3.matches[0].card.name}`);
