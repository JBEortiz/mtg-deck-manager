import { fetchDeckCards, fetchDecks } from "../services/api";
const TYPE_KEYWORDS = [
    "creature",
    "instant",
    "sorcery",
    "artifact",
    "enchantment",
    "land",
    "planeswalker",
    "battle",
    "aura",
    "equipment",
    "vehicle"
];
const ROLE_KEYWORDS = [
    {
        role: "removal",
        phrases: ["removal", "board wipe"],
        nameHints: ["destroy", "exile", "remove", "bounce", "kill", "edict", "wrath", "sweep"],
        typeHints: ["instant", "sorcery"]
    },
    {
        role: "counterspell",
        phrases: ["counterspell", "counter spell"],
        nameHints: ["counter", "negate", "cancel", "dismiss", "dispel", "remand"],
        typeHints: ["instant"]
    },
    {
        role: "draw",
        phrases: ["draw", "card draw"],
        nameHints: ["draw", "study", "vision", "consult", "read", "loot"],
        typeHints: ["instant", "sorcery"]
    },
    {
        role: "ramp",
        phrases: ["ramp", "mana acceleration"],
        nameHints: ["cultivate", "harrow", "farseek", "rampant", "growth", "signet", "talisman"],
        typeHints: ["artifact", "sorcery", "creature"]
    },
    {
        role: "protection",
        phrases: ["protection"],
        nameHints: ["protect", "shield", "hexproof", "ward", "indestructible"],
        typeHints: ["instant", "enchantment"]
    }
];
const COLOR_KEYWORDS = [
    { code: "W", phrases: ["white", "mono white"] },
    { code: "U", phrases: ["blue", "mono blue"] },
    { code: "B", phrases: ["black", "mono black"] },
    { code: "R", phrases: ["red", "mono red"] },
    { code: "G", phrases: ["green", "mono green"] },
    { code: "C", phrases: ["colorless", "color less"] }
];
const STOPWORDS = new Set([
    "what",
    "is",
    "this",
    "deck",
    "missing",
    "for",
    "the",
    "a",
    "an",
    "and",
    "of",
    "to",
    "my",
    "your",
    "with",
    "in",
    "on",
    "at",
    "does",
    "do",
    "i",
    "we",
    "they",
    "it",
    "work",
    "works",
    "card",
    "cards",
    "find",
    "search",
    "show",
    "me",
    "please",
    "any",
    "best",
    "want",
    "need"
]);
function normalize(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function tokenize(text) {
    return normalize(text).split(" ").filter(Boolean);
}
function includesPhrase(text, phrase) {
    return normalize(text).includes(normalize(phrase));
}
function parseColors(query) {
    const normalized = normalize(query);
    const tokens = new Set(tokenize(query));
    const colors = [];
    for (const color of COLOR_KEYWORDS) {
        const hit = color.phrases.some((phrase) => includesPhrase(normalized, phrase));
        const symbolHit = tokens.has(color.code.toLowerCase());
        if (hit || symbolHit) {
            colors.push(color.code);
        }
    }
    return colors;
}
function parseManaQuery(query) {
    const normalized = normalize(query);
    const exactLabel = normalized.match(/\b(?:mana value|mana cost|mv|cmc)\s*(\d+)\b/);
    if (exactLabel) {
        return { manaExact: Number(exactLabel[1]) };
    }
    const exactMana = normalized.match(/\b(\d+)\s*(?:mana|mv|cmc)\b/);
    if (exactMana) {
        return { manaExact: Number(exactMana[1]) };
    }
    const upperBound = normalized.match(/\b(?:under|less than|at most|up to|no more than)\s*(\d+)\b/);
    if (upperBound) {
        return { manaMax: Number(upperBound[1]) };
    }
    const lowerBound = normalized.match(/\b(?:over|at least|more than|minimum(?: of)?|minimum)\s*(\d+)\b/);
    if (lowerBound) {
        return { manaMin: Number(lowerBound[1]) };
    }
    const shortForm = normalized.match(/\b(\d+)\+\b/);
    if (shortForm) {
        return { manaMin: Number(shortForm[1]) };
    }
    return {};
}
function parseTypes(query) {
    const normalized = normalize(query);
    return TYPE_KEYWORDS.filter((term) => includesPhrase(normalized, term));
}
function parseRoles(query) {
    const normalized = normalize(query);
    return ROLE_KEYWORDS.filter((role) => role.phrases.some((phrase) => includesPhrase(normalized, phrase))).map((role) => role.role);
}
function parseNameTerms(query) {
    const words = tokenize(query);
    return words.filter((word) => !STOPWORDS.has(word) && !TYPE_KEYWORDS.includes(word) && !COLOR_KEYWORDS.some((color) => color.code.toLowerCase() === word) && !ROLE_KEYWORDS.some((role) => role.role === word || role.phrases.some((phrase) => includesPhrase(word, phrase))));
}
function parseCardQuery(query) {
    return {
        colors: parseColors(query),
        ...parseManaQuery(query),
        typeTerms: parseTypes(query),
        roleTerms: parseRoles(query),
        nameTerms: parseNameTerms(query)
    };
}
function parseCardColors(colors) {
    const normalized = normalize(colors).toUpperCase();
    const tokens = normalized.split(/[^A-Z]+/).filter(Boolean);
    return new Set(tokens);
}
function colorLabel(code) {
    switch (code) {
        case "W":
            return "white";
        case "U":
            return "blue";
        case "B":
            return "black";
        case "R":
            return "red";
        case "G":
            return "green";
        case "C":
            return "colorless";
        default:
            return code;
    }
}
function roleScore(role, card, cardName, cardType) {
    const nameHints = ROLE_KEYWORDS.find((entry) => entry.role === role)?.nameHints ?? [];
    const typeHints = ROLE_KEYWORDS.find((entry) => entry.role === role)?.typeHints ?? [];
    if (role === "removal") {
        let score = 0;
        if (typeHints.some((hint) => cardType.includes(hint))) {
            score += 2;
        }
        if (nameHints.some((hint) => cardName.includes(hint))) {
            score += 3;
        }
        if (score > 0) {
            return { score, reason: "removal-style card" };
        }
        return { score: 0 };
    }
    if (role === "counterspell") {
        let score = 0;
        if (typeHints.some((hint) => cardType.includes(hint))) {
            score += 2;
        }
        if (nameHints.some((hint) => cardName.includes(hint))) {
            score += 3;
        }
        if (score > 0) {
            return { score, reason: "counterspell-style card" };
        }
        return { score: 0 };
    }
    if (role === "draw") {
        let score = 0;
        if (typeHints.some((hint) => cardType.includes(hint))) {
            score += 1;
        }
        if (nameHints.some((hint) => cardName.includes(hint))) {
            score += 3;
        }
        if (score > 0) {
            return { score, reason: "card draw" };
        }
        return { score: 0 };
    }
    if (role === "ramp") {
        let score = 0;
        if (typeHints.some((hint) => cardType.includes(hint))) {
            score += 1;
        }
        if (nameHints.some((hint) => cardName.includes(hint))) {
            score += 3;
        }
        if (score > 0) {
            return { score, reason: "ramp piece" };
        }
        return { score: 0 };
    }
    if (role === "protection") {
        let score = 0;
        if (typeHints.some((hint) => cardType.includes(hint))) {
            score += 1;
        }
        if (nameHints.some((hint) => cardName.includes(hint))) {
            score += 3;
        }
        if (score > 0) {
            return { score, reason: "protection effect" };
        }
        return { score: 0 };
    }
    return { score: 0 };
}
function scoreRecord(record, parsed, relaxed = false) {
    const cardName = normalize(record.card.name);
    const cardType = normalize(record.card.type);
    const cardColors = parseCardColors(record.card.colors);
    const reasons = [];
    let score = 0;
    let strictHit = true;
    if (parsed.colors.length > 0) {
        const matchedColors = parsed.colors.filter((color) => cardColors.has(color));
        if (matchedColors.length > 0) {
            score += matchedColors.length * 4;
            reasons.push(...matchedColors.map(colorLabel));
        }
        else {
            strictHit = false;
        }
    }
    if (parsed.manaExact !== undefined) {
        if (record.card.manaValue === parsed.manaExact) {
            score += 5;
            reasons.push(`mana value ${parsed.manaExact}`);
        }
        else {
            strictHit = false;
        }
    }
    else {
        if (parsed.manaMin !== undefined) {
            if (record.card.manaValue >= parsed.manaMin) {
                score += record.card.manaValue === parsed.manaMin ? 4 : 2;
                reasons.push(`mana ${record.card.manaValue}+`);
            }
            else {
                strictHit = false;
            }
        }
        if (parsed.manaMax !== undefined) {
            if (record.card.manaValue <= parsed.manaMax) {
                score += record.card.manaValue === parsed.manaMax ? 4 : 2;
                reasons.push(`mana up to ${parsed.manaMax}`);
            }
            else {
                strictHit = false;
            }
        }
    }
    if (parsed.typeTerms.length > 0) {
        const matchedTypes = parsed.typeTerms.filter((typeTerm) => cardType.includes(typeTerm));
        if (matchedTypes.length > 0) {
            score += matchedTypes.length * 3;
            reasons.push(...matchedTypes);
        }
        else {
            strictHit = false;
        }
    }
    if (parsed.nameTerms.length > 0) {
        const matchedNameTerms = parsed.nameTerms.filter((term) => cardName.includes(term));
        if (matchedNameTerms.length > 0) {
            score += matchedNameTerms.length * 2;
            reasons.push(...matchedNameTerms);
        }
        else {
            strictHit = false;
        }
    }
    for (const role of parsed.roleTerms) {
        const result = roleScore(role, record.card, cardName, cardType);
        if (result.score > 0) {
            score += result.score;
            reasons.push(result.reason ?? role);
        }
        else if (relaxed) {
            if (role === "removal" && (cardType.includes("instant") || cardType.includes("sorcery"))) {
                score += 1;
                reasons.push("spell speed");
            }
        }
    }
    if (score === 0 && relaxed) {
        if (parsed.colors.length > 0 && parsed.colors.some((color) => cardColors.has(color))) {
            score += 1;
        }
        if (parsed.manaExact !== undefined && Math.abs(record.card.manaValue - parsed.manaExact) <= 1) {
            score += 1;
            reasons.push(`close to mana value ${parsed.manaExact}`);
        }
        if (parsed.typeTerms.length > 0 && parsed.typeTerms.some((typeTerm) => cardType.includes(typeTerm))) {
            score += 1;
        }
    }
    return { score, reasons, strictHit };
}
async function loadAssistantCards() {
    try {
        const decks = await fetchDecks();
        const cardsPerDeck = await Promise.all(decks.map(async (deck) => {
            const cards = await fetchDeckCards(deck.id, {
                name: "",
                type: "",
                color: "",
                sort: "name:asc"
            });
            return cards.map((card) => ({
                deckId: deck.id,
                deckName: deck.name,
                card
            }));
        }));
        return {
            deckCount: decks.length,
            cards: cardsPerDeck.flat()
        };
    }
    catch (error) {
        return {
            deckCount: 0,
            cards: [],
            error: error instanceof Error ? error.message : "Could not load cards."
        };
    }
}
function summarizeFilters(parsed) {
    const filters = [];
    for (const color of parsed.colors) {
        filters.push(colorLabel(color));
    }
    if (parsed.manaExact !== undefined) {
        filters.push(`mana value ${parsed.manaExact}`);
    }
    else {
        if (parsed.manaMin !== undefined) {
            filters.push(`mana ${parsed.manaMin}+`);
        }
        if (parsed.manaMax !== undefined) {
            filters.push(`mana up to ${parsed.manaMax}`);
        }
    }
    filters.push(...parsed.typeTerms);
    filters.push(...parsed.roleTerms);
    if (parsed.nameTerms.length > 0) {
        filters.push(`name: ${parsed.nameTerms.join(" ")}`);
    }
    return filters;
}
export async function searchCardsForAssistant(query) {
    const parsed = parseCardQuery(query);
    const filters = summarizeFilters(parsed);
    const catalog = await loadAssistantCards();
    if (catalog.error) {
        return {
            deckCount: 0,
            cardCount: 0,
            filters,
            summary: "Card search is unavailable right now.",
            note: catalog.error,
            relaxed: false,
            matches: []
        };
    }
    if (catalog.cards.length === 0) {
        return {
            deckCount: catalog.deckCount,
            cardCount: 0,
            filters,
            summary: "No cards are saved yet, so there is nothing to search.",
            note: "Create a deck and add cards first, then try the assistant again.",
            relaxed: false,
            matches: []
        };
    }
    const strictMatches = catalog.cards
        .map((record) => {
        const scored = scoreRecord(record, parsed, false);
        return scored.strictHit && scored.score > 0 ? { ...record, ...scored } : null;
    })
        .filter((match) => match !== null)
        .sort((left, right) => right.score - left.score || left.card.name.localeCompare(right.card.name));
    const relaxedMatches = strictMatches.length > 0
        ? strictMatches
        : catalog.cards
            .map((record) => ({ ...record, ...scoreRecord(record, parsed, true) }))
            .filter((match) => match.score > 0)
            .sort((left, right) => right.score - left.score || left.card.name.localeCompare(right.card.name));
    const matches = relaxedMatches.slice(0, 6).map((match) => ({
        deckId: match.deckId,
        deckName: match.deckName,
        card: match.card,
        score: match.score,
        reasons: match.reasons
    }));
    const exactCount = strictMatches.length;
    const relaxed = strictMatches.length === 0;
    return {
        deckCount: catalog.deckCount,
        cardCount: catalog.cards.length,
        filters,
        summary: matches.length > 0
            ? relaxed
                ? `No exact matches. Showing the closest cards from ${catalog.deckCount} deck${catalog.deckCount === 1 ? "" : "s"}.`
                : `Found ${exactCount} matching card${exactCount === 1 ? "" : "s"} across ${catalog.deckCount} deck${catalog.deckCount === 1 ? "" : "s"}.`
            : `No cards matched your request yet.`,
        note: matches.length > 0
            ? `Searched ${catalog.cards.length} cards saved across ${catalog.deckCount} deck${catalog.deckCount === 1 ? "" : "s"}.`
            : "Try a card name, a color, a mana value, or a card type like creature or instant.",
        relaxed,
        matches
    };
}
