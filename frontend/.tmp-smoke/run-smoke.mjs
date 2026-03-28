import { searchCardsForAssistant } from "./cardSearch.js";
const result = await searchCardsForAssistant("white removal mana value 2");
const first = result.matches[0];
if (!first) {
  console.log("ASSISTANT_CARD_SEARCH_FAIL no_matches");
  process.exit(2);
}
console.log(`ASSISTANT_CARD_SEARCH_OK top=${first.card.name} score=${first.score} matches=${result.matches.length}`);
