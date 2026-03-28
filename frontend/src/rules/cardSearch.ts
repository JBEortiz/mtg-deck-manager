import { fetchScryfallSearch } from "../services/api";
import { CardLookupResult } from "../types/models";

export type AssistantCardMatch = {
  card: CardLookupResult;
  score: number;
  reasons: string[];
};

export type AssistantCardSearchResult = {
  filters: string[];
  summary: string;
  note: string;
  query: string;
  matches: AssistantCardMatch[];
};

type ParsedCardQuery = {
  colors: string[];
  manaValue?: number;
  typeTerms: string[];
  roleTerms: string[];
  reach: boolean;
};

const COLOR_MAP: Array<{ phrase: string; code: string; scryfall: string }> = [
  { phrase: "white", code: "W", scryfall: "c:w" },
  { phrase: "blue", code: "U", scryfall: "c:u" },
  { phrase: "black", code: "B", scryfall: "c:b" },
  { phrase: "red", code: "R", scryfall: "c:r" },
  { phrase: "green", code: "G", scryfall: "c:g" },
  { phrase: "colorless", code: "C", scryfall: "c:c" }
];

const TYPE_TERMS = ["creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker"];

const ROLE_MAP: Array<{ role: string; phrases: string[]; scryfall: string }> = [
  { role: "removal", phrases: ["removal", "kill", "destroy", "exile"], scryfall: "(o:destroy or o:exile)" },
  { role: "ramp", phrases: ["ramp", "mana rock", "mana dork"], scryfall: "(o:\"add {\" or o:\"search your library\")" },
  { role: "draw", phrases: ["draw", "card draw"], scryfall: "o:\"draw a card\"" },
  { role: "counterspell", phrases: ["counter", "counterspell"], scryfall: "o:counter" }
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPhrase(text: string, phrase: string): boolean {
  return normalize(text).includes(normalize(phrase));
}

function parseCardQuery(query: string): ParsedCardQuery {
  const normalized = normalize(query);

  const colors = COLOR_MAP.filter((color) => includesPhrase(normalized, color.phrase)).map((color) => color.code);

  const manaMatch = normalized.match(/(?:mana value|mana cost|mv|cmc|cost)\s*(\d+)/) ?? normalized.match(/\b(\d+)\s*(?:mana|mv|cmc|cost)\b/);
  const manaValue = manaMatch ? Number(manaMatch[1]) : undefined;

  const typeTerms = TYPE_TERMS.filter((typeTerm) => includesPhrase(normalized, typeTerm));

  const roleTerms = ROLE_MAP.filter((role) => role.phrases.some((phrase) => includesPhrase(normalized, phrase))).map((role) => role.role);

  const reach = includesPhrase(normalized, "reach");

  return { colors, manaValue, typeTerms, roleTerms, reach };
}

function buildScryfallQuery(rawQuery: string, parsed: ParsedCardQuery): string {
  const parts: string[] = [];

  for (const color of parsed.colors) {
    const mapped = COLOR_MAP.find((entry) => entry.code === color);
    if (mapped) {
      parts.push(mapped.scryfall);
    }
  }

  if (parsed.manaValue !== undefined) {
    parts.push(`mv=${parsed.manaValue}`);
  }

  for (const typeTerm of parsed.typeTerms) {
    parts.push(`t:${typeTerm}`);
  }

  for (const roleTerm of parsed.roleTerms) {
    const mapped = ROLE_MAP.find((entry) => entry.role === roleTerm);
    if (mapped) {
      parts.push(mapped.scryfall);
    }
  }

  if (parsed.reach) {
    parts.push("o:reach");
  }

  return parts.length > 0 ? parts.join(" ") : rawQuery;
}

function buildFilters(parsed: ParsedCardQuery): string[] {
  const filters: string[] = [];

  filters.push(...parsed.colors.map((color) => COLOR_MAP.find((entry) => entry.code === color)?.phrase ?? color));

  if (parsed.manaValue !== undefined) {
    filters.push(`mana value ${parsed.manaValue}`);
  }

  filters.push(...parsed.typeTerms);
  filters.push(...parsed.roleTerms);

  if (parsed.reach) {
    filters.push("reach");
  }

  return filters;
}

function scoreCard(card: CardLookupResult, parsed: ParsedCardQuery): { score: number; reasons: string[] } {
  const type = normalize(card.type);
  const colors = normalize(card.colors).toUpperCase();
  const reasons: string[] = [];
  let score = 0;

  for (const color of parsed.colors) {
    if (colors.includes(color)) {
      score += 3;
      reasons.push(COLOR_MAP.find((entry) => entry.code === color)?.phrase ?? color);
    }
  }

  if (parsed.manaValue !== undefined && card.manaValue === parsed.manaValue) {
    score += 4;
    reasons.push(`mana value ${parsed.manaValue}`);
  }

  for (const typeTerm of parsed.typeTerms) {
    if (type.includes(typeTerm)) {
      score += 2;
      reasons.push(typeTerm);
    }
  }

  if (parsed.reach && type.includes("reach")) {
    score += 2;
    reasons.push("reach");
  }

  return { score, reasons };
}

export async function searchCardsForAssistant(query: string): Promise<AssistantCardSearchResult> {
  const parsed = parseCardQuery(query);
  const filters = buildFilters(parsed);
  const scryfallQuery = buildScryfallQuery(query, parsed);
  const cards = await fetchScryfallSearch(scryfallQuery, 8);

  const matches = cards
    .map((card) => {
      const scored = scoreCard(card, parsed);
      return {
        card,
        score: scored.score,
        reasons: scored.reasons
      };
    })
    .sort((left, right) => right.score - left.score || left.card.name.localeCompare(right.card.name));

  return {
    filters,
    query: scryfallQuery,
    summary: matches.length > 0
      ? `Found ${matches.length} card suggestion${matches.length === 1 ? "" : "s"}.`
      : "No cards matched that query.",
    note: matches.length > 0
      ? "Results are from Scryfall query matching."
      : "Try adding a color, type, role, or mana value.",
    matches
  };
}
