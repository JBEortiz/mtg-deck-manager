export type AssistantIntent = "rules" | "cards" | "deck";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreByKeywords(query: string, keywords: string[]): number {
  const normalized = normalize(query);
  let score = 0;

  for (const keyword of keywords) {
    const key = normalize(keyword);
    if (!key) {
      continue;
    }

    if (normalized.includes(key)) {
      score += key.includes(" ") ? 3 : 2;
    }
  }

  return score;
}

const RULES_KEYWORDS = [
  "rule",
  "stack",
  "combat",
  "trigger",
  "respond",
  "resolution",
  "hexproof",
  "shroud",
  "ward",
  "ninjutsu",
  "indestructible",
  "deathtouch",
  "lifelink",
  "first strike",
  "double strike",
  "trample",
  "flash",
  "vigilance",
  "menace",
  "equip",
  "cascade"
];

const CARD_KEYWORDS = [
  "card",
  "search",
  "find",
  "removal",
  "board wipe",
  "draw",
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "mana value",
  "mana cost",
  "cmc",
  "mv",
  "white",
  "blue",
  "black",
  "red",
  "green",
  "colorless",
  "cheap",
  "budget",
  "mono",
  "multicolor",
  "reach",
  "ramp",
  "cost"
];

const DECK_KEYWORDS = [
  "deck",
  "missing",
  "improve",
  "upgrade",
  "analysis",
  "analyze",
  "mana base",
  "curve",
  "consistency",
  "synergy",
  "cuts",
  "what is this deck missing"
];

export function detectAssistantIntent(query: string): AssistantIntent {
  const rulesScore = scoreByKeywords(query, RULES_KEYWORDS);
  const cardsScore = scoreByKeywords(query, CARD_KEYWORDS);
  const deckScore = scoreByKeywords(query, DECK_KEYWORDS);

  if (deckScore >= cardsScore && deckScore >= rulesScore && deckScore > 0) {
    return "deck";
  }

  if (cardsScore >= rulesScore && cardsScore > 0) {
    return "cards";
  }

  return "rules";
}
