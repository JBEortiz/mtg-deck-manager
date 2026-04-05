import { RULES_ENTRIES, RulesEntry } from "./rulesData";

export type RulesMatchResult = {
  entry: RulesEntry;
  score: number;
  specificity: number;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter((token) => token.length > 1);
}

function scoreEntry(question: string, entry: RulesEntry): { score: number; specificity: number } {
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) {
    return { score: 0, specificity: 0 };
  }

  let score = 0;
  let specificity = 0;

  const namePhrase = normalize(entry.name);
  if (namePhrase && normalizedQuestion.includes(namePhrase)) {
    score += 8;
    specificity += namePhrase.length;
  }

  for (const alias of entry.aliases) {
    const aliasPhrase = normalize(alias);
    if (!aliasPhrase) {
      continue;
    }

    if (normalizedQuestion.includes(aliasPhrase)) {
      score += aliasPhrase.includes(" ") ? 6 : 4;
      specificity += aliasPhrase.length;
    }
  }

  const questionTokens = new Set(tokenize(question));
  const entryTokens = new Set(tokenize([entry.name, ...entry.aliases].join(" ")));

  for (const token of questionTokens) {
    if (entryTokens.has(token)) {
      score += 1;
      specificity += token.length;
    }
  }

  return { score, specificity };
}

export function findBestRulesMatch(question: string): RulesMatchResult | null {
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) {
    return null;
  }

  let best: RulesMatchResult | null = null;

  for (const entry of RULES_ENTRIES) {
    const result = scoreEntry(question, entry);
    if (!best || result.score > best.score || (result.score === best.score && result.specificity > best.specificity)) {
      best = { entry, score: result.score, specificity: result.specificity };
    }
  }

  if (!best || best.score < 3) {
    return null;
  }

  return best;
}
