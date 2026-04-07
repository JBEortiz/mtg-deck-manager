import "server-only";

import type { DeckPassport, MulliganSample } from "@/lib/types";
import type { StoredCard, StoredDeck } from "@/lib/server/mtg-store";

type RoleHeuristic = {
  exactNames: Set<string>;
  nameTerms: string[];
  typeTerms: string[];
};

type WatchoutHeuristic = {
  commonStackUsage: string;
  description: string;
  label: string;
  practicalNote: string;
  terms: string[];
  typeTerms: string[];
};

type HandCard = {
  colors: string[];
  imageUrl: string | null;
  isDraw: boolean;
  isLand: boolean;
  isRamp: boolean;
  isRemoval: boolean;
  manaValue: number;
  name: string;
  type: string;
};

type DeckProfile = {
  cheapRatio: number;
  earlyPlan: string;
};

export type DeckCardRoleFlags = {
  boardWipe: boolean;
  draw: boolean;
  finisher: boolean;
  protection: boolean;
  ramp: boolean;
  removal: boolean;
};

type HandAssessment = {
  fitsEarlyCurve: boolean;
  hasColorAccess: boolean;
  hasDraw: boolean;
  hasEarlyPlayable: boolean;
  hasRamp: boolean;
  landCount: number;
  note: string;
  signals: string[];
  verdict: "Keep" | "Borderline" | "Mulligan";
};

const COLOR_ORDER = ["W", "U", "B", "R", "G", "C"] as const;

function normalize(value: string | null | undefined): string {
  return value == null ? "" : value.trim().toLowerCase();
}

function quantity(card: { quantity: number | null | undefined }) {
  return card.quantity == null ? 0 : Math.max(0, card.quantity);
}

function splitColors(colors: string | null | undefined) {
  if (!colors) {
    return [];
  }

  return colors
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function createRoleHeuristics(source: Array<[string[], string[], string[]]>): RoleHeuristic[] {
  return source.map(([exactNames, nameTerms, typeTerms]) => ({
    exactNames: new Set(exactNames.map((value) => value.toLowerCase())),
    nameTerms: nameTerms.map((value) => value.toLowerCase()),
    typeTerms: typeTerms.map((value) => value.toLowerCase())
  }));
}

const RAMP_HEURISTICS = createRoleHeuristics([
  [["sol ring", "arcane signet", "fellwar stone", "mind stone", "commander sphere"], [], []],
  [[], ["signet", "talisman"], []],
  [[], ["ramp", "cultivate", "kodama", "lantern", "mana", "treasure"], ["artifact", "sorcery", "creature"]]
]);

const DRAW_HEURISTICS = createRoleHeuristics([
  [["ponder", "preordain", "brainstorm", "rhystic study", "phyrexian arena"], [], []],
  [[], ["draw", "study", "visions", "insight", "knowledge", "discovery"], ["instant", "sorcery", "enchantment"]]
]);

const REMOVAL_HEURISTICS = createRoleHeuristics([
  [["swords to plowshares", "path to exile", "lightning bolt", "assassin's trophy", "beast within", "generous gift", "cyclonic rift"], [], []],
  [[], ["bolt", "exile", "doom", "mortify", "chaos", "removal", "command"], ["instant", "sorcery"]]
]);

const BOARD_WIPE_HEURISTICS = createRoleHeuristics([
  [["wrath of god", "damnation", "blasphemous act", "farewell", "supreme verdict", "austere command"], [], []],
  [[], ["wrath", "damnation", "verdict", "farewell", "sweeper"], ["sorcery", "instant"]]
]);

const PROTECTION_HEURISTICS = createRoleHeuristics([
  [["heroic intervention", "teferi's protection", "swiftfoot boots", "lightning greaves"], [], []],
  [[], ["protection", "boots", "greaves", "intervention", "safekeeping", "stand"], ["instant", "artifact"]]
]);

const FINISHER_HEURISTICS = createRoleHeuristics([
  [["craterhoof behemoth", "overwhelming stampede", "torment of hailfire", "expropriate", "insurrection"], [], []],
  [[], ["overrun", "behemoth", "hailfire", "extra turn", "finale", "insurrection"], ["creature", "sorcery"]]
]);

const WATCHOUT_HEURISTICS: WatchoutHeuristic[] = [
  { label: "Ward", description: "Ward triggers after targeting and can tax or counter interaction.", commonStackUsage: "Yes", practicalNote: "The original spell still targets first, then ward goes on the stack.", terms: ["ward"], typeTerms: [] },
  { label: "Cascade", description: "Cascade is a cast trigger that can change sequencing and mana-value decisions.", commonStackUsage: "Yes", practicalNote: "The cascade trigger resolves before the original spell resolves.", terms: ["cascade", "devastator"], typeTerms: [] },
  { label: "Equip", description: "Equip usually works only at sorcery speed and often causes timing confusion.", commonStackUsage: "Yes", practicalNote: "Most Equipment cannot be moved in combat unless another effect says so.", terms: ["equip", "equipment"], typeTerms: ["artifact"] },
  { label: "Ninjutsu", description: "Ninjutsu is an activated ability tied to unblocked attackers and combat timing.", commonStackUsage: "Yes", practicalNote: "If the unblocked attacker is gone when ninjutsu resolves, it fails.", terms: ["ninjutsu", "ninja"], typeTerms: [] },
  { label: "Flash", description: "Flash changes when you can cast a spell, which often matters in combat and end steps.", commonStackUsage: "Sometimes", practicalNote: "A flashed-in creature after blockers are declared will not become a blocker that combat.", terms: ["flash"], typeTerms: [] },
  { label: "Hexproof / Shroud", description: "These abilities change targeting rules and are easy to misread in removal exchanges.", commonStackUsage: "No", practicalNote: "Hexproof stops opponents from targeting, while shroud stops everyone from targeting.", terms: ["hexproof", "shroud"], typeTerms: [] },
  { label: "First Strike / Double Strike", description: "Extra combat-damage steps change which creatures live long enough to hit back.", commonStackUsage: "No", practicalNote: "If a creature dies in first-strike damage, it will not deal regular combat damage.", terms: ["first strike", "double strike"], typeTerms: [] },
  { label: "Trample + Deathtouch", description: "This pairing changes what counts as lethal damage during combat assignment.", commonStackUsage: "No", practicalNote: "Usually only 1 damage needs to be assigned to a blocker before the rest can trample over.", terms: ["trample", "deathtouch"], typeTerms: [] }
];

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function matchesHeuristic(card: { name: string; type: string }, heuristic: RoleHeuristic) {
  const name = normalize(card.name);
  const type = normalize(card.type);
  if (heuristic.exactNames.has(name)) {
    return true;
  }
  const nameMatch = heuristic.nameTerms.some((term) => name.includes(term));
  return nameMatch && (heuristic.typeTerms.length === 0 || heuristic.typeTerms.some((term) => type.includes(term)));
}

export function classifyDeckCardRoles(card: { name: string; type: string }): DeckCardRoleFlags {
  return {
    ramp: RAMP_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic)),
    draw: DRAW_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic)),
    removal: REMOVAL_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic)),
    boardWipe: BOARD_WIPE_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic)),
    protection: PROTECTION_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic)),
    finisher: FINISHER_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic))
  };
}

function countRole(cards: StoredCard[], heuristics: RoleHeuristic[]) {
  return cards.reduce((total, card) => total + (heuristics.some((heuristic) => matchesHeuristic(card, heuristic)) ? quantity(card) : 0), 0);
}

function buildManaCurve(cards: StoredCard[]) {
  const map = new Map<number, number>();
  for (const card of cards) {
    map.set(card.manaValue, (map.get(card.manaValue) ?? 0) + quantity(card));
  }
  return Object.fromEntries([...map.entries()].sort((left, right) => left[0] - right[0]));
}

function buildTypeCounts(cards: StoredCard[]) {
  const byType: Record<string, number> = {};
  for (const card of cards) {
    byType[card.type] = (byType[card.type] ?? 0) + quantity(card);
  }
  return byType;
}

function buildDeckColors(cards: StoredCard[]) {
  const colors = new Set<string>();
  for (const code of COLOR_ORDER) {
    for (const card of cards) {
      for (const token of splitColors(card.colors)) {
        const normalizedToken = normalize(token);
        const matches =
          (code === "W" && (normalizedToken === "w" || normalizedToken === "white")) ||
          (code === "U" && (normalizedToken === "u" || normalizedToken === "blue")) ||
          (code === "B" && (normalizedToken === "b" || normalizedToken === "black")) ||
          (code === "R" && (normalizedToken === "r" || normalizedToken === "red")) ||
          (code === "G" && (normalizedToken === "g" || normalizedToken === "green")) ||
          (code === "C" && (normalizedToken === "c" || normalizedToken === "colorless"));
        if (matches) {
          colors.add(code);
        }
      }
    }
  }
  return [...colors];
}

function hasType(byType: Record<string, number>, term: string) {
  return Object.keys(byType).some((key) => normalize(key).includes(normalize(term)));
}

function roleLabel(roleKey: string) {
  switch (roleKey) {
    case "ramp":
      return "ramp-focused";
    case "draw":
      return "card-advantage";
    case "removal":
    case "boardWipes":
      return "interaction-heavy";
    case "protection":
      return "protection-oriented";
    case "finishers":
      return "finisher-driven";
    default:
      return "value-oriented";
  }
}

function maxRole(roles: Record<string, number>) {
  return Object.entries(roles).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "value";
}

export function buildDeckPassport(deck: StoredDeck, cards: StoredCard[]): DeckPassport {
  const totalCards = cards.reduce((total, card) => total + quantity(card), 0);
  const byType = buildTypeCounts(cards);
  const manaCurve = buildManaCurve(cards);
  const colors = buildDeckColors(cards);
  const roles = {
    ramp: countRole(cards, RAMP_HEURISTICS),
    draw: countRole(cards, DRAW_HEURISTICS),
    removal: countRole(cards, REMOVAL_HEURISTICS),
    boardWipes: countRole(cards, BOARD_WIPE_HEURISTICS),
    protection: countRole(cards, PROTECTION_HEURISTICS),
    finishers: countRole(cards, FINISHER_HEURISTICS)
  };

  const warnings: string[] = [];
  if (totalCards === 0) {
    warnings.push("This deck is empty. Add cards to generate a useful passport.");
  } else {
    if (totalCards < 60) warnings.push("This deck still looks incomplete. Add more cards before trusting the summary.");
    if (roles.draw < 6) warnings.push("Card draw looks light. You may run out of gas in longer games.");
    if (roles.ramp < 8) warnings.push("Ramp looks light. Early development may be slower than expected.");
    if (roles.removal + roles.boardWipes < 8) warnings.push("Interaction looks low. The deck may struggle to answer opposing threats.");
    if (roles.finishers < 3) warnings.push("Finishers look light. Closing games may be inconsistent.");
    const weightedTotal = Object.values(manaCurve).reduce((sum, value) => sum + value, 0);
    const highCurveCount = Object.entries(manaCurve).reduce((sum, [key, value]) => sum + (Number(key) >= 5 ? value : 0), 0);
    if (weightedTotal > 0 && (highCurveCount * 100) / weightedTotal >= 35) {
      warnings.push("Mana curve is on the heavier side. Expect slower starts without enough ramp.");
    }
  }

  const rulesWatchouts: DeckPassport["rulesWatchouts"] = [];
  const commander = normalize(deck.commander);
  for (const heuristic of WATCHOUT_HEURISTICS) {
    const matches = heuristic.label === "Trample + Deathtouch"
      ? ((cards.some((card) => `${normalize(card.name)} ${normalize(card.type)}`.includes("trample")) || commander.includes("trample")) &&
         (cards.some((card) => `${normalize(card.name)} ${normalize(card.type)}`.includes("deathtouch")) || commander.includes("deathtouch")))
      : cards.some((card) => {
          const query = `${normalize(card.name)} ${normalize(card.type)}`;
          return heuristic.terms.some((term) => query.includes(term)) || heuristic.typeTerms.some((term) => normalize(card.type).includes(term));
        }) || heuristic.terms.some((term) => commander.includes(term));
    if (matches) {
      rulesWatchouts.push({
        label: heuristic.label,
        description: heuristic.description,
        commonStackUsage: heuristic.commonStackUsage,
        practicalNote: heuristic.practicalNote
      });
    }
  }

  const primaryType = Object.entries(byType).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "spells";
  const cheapCards = Object.entries(manaCurve).reduce((sum, [key, value]) => sum + (Number(key) <= 2 ? value : 0), 0);

  return {
    deckName: deck.name,
    format: deck.format,
    commander: deck.commander,
    colors,
    totalCards,
    byType,
    manaCurve,
    gamePlan: cards.length === 0 ? "This deck does not have enough cards yet to identify a real game plan." : `${deck.name} looks like a ${roleLabel(maxRole(roles))} deck built around ${deck.commander?.trim() || "the commander"}, with most of the list leaning on ${primaryType.toLowerCase()}.`,
    winPlan: cards.length === 0 ? "Add more cards to estimate how this deck is likely to win." : (roles.finishers >= 4 ? "The deck appears to aim for a clear finishing turn, using a few top-end payoff cards to close once it is set up." : (hasType(byType, "creature") ? "It likely wins by building board presence and turning creatures or value engines into steady pressure." : ((hasType(byType, "instant") || hasType(byType, "sorcery")) ? "It likely wins by chaining spells, controlling the table, and converting that tempo into a closing sequence." : "It likely wins by incremental value, then pulling ahead with its strongest cards in the mid to late game."))),
    earlyGamePlan: totalCards === 0 ? "Early-game guidance will appear once the deck has some cards." : (roles.ramp >= 8 ? "Early turns are likely focused on mana development so the deck can reach its stronger plays ahead of curve." : ((roles.draw >= 6 && cheapCards >= 10) ? "Early turns are likely about smoothing draws, developing resources, and staying flexible." : (roles.removal >= 6 ? "Early turns are likely spent interacting, buying time, and keeping the board manageable." : "Early turns look more setup-oriented, with a mix of development and general curve plays before the main plan turns on."))),
    roles,
    warnings,
    rulesWatchouts
  };
}

function shuffle<T>(values: T[]) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function expandDeck(cards: StoredCard[]): HandCard[] {
  const deckPool: HandCard[] = [];
  for (const card of cards) {
    const colors = splitColors(card.colors).map(normalize);
    const isRamp = RAMP_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic));
    const isDraw = DRAW_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic));
    const isRemoval = REMOVAL_HEURISTICS.some((heuristic) => matchesHeuristic(card, heuristic));
    for (let count = 0; count < quantity(card); count += 1) {
      deckPool.push({
        name: card.name,
        manaValue: card.manaValue,
        type: card.type,
        isLand: normalize(card.type).includes("land"),
        imageUrl: firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl),
        colors,
        isRamp,
        isDraw,
        isRemoval
      });
    }
  }
  return deckPool;
}

function buildDeckProfile(deckPool: HandCard[]): DeckProfile {
  const nonLands = deckPool.filter((card) => !card.isLand);
  const cheapPlays = nonLands.filter((card) => card.manaValue <= 3).length;
  const highCurveCards = nonLands.filter((card) => card.manaValue >= 5).length;
  const rampCards = deckPool.filter((card) => card.isRamp).length;
  const drawCards = deckPool.filter((card) => card.isDraw).length;
  const removalCards = deckPool.filter((card) => card.isRemoval).length;
  const cheapRatio = nonLands.length === 0 ? 0 : cheapPlays / nonLands.length;
  const highCurveRatio = nonLands.length === 0 ? 0 : highCurveCards / nonLands.length;
  const rampRatio = deckPool.length === 0 ? 0 : rampCards / deckPool.length;
  const drawRatio = deckPool.length === 0 ? 0 : drawCards / deckPool.length;
  const removalRatio = deckPool.length === 0 ? 0 : removalCards / deckPool.length;

  return {
    cheapRatio,
    earlyPlan: rampRatio >= 0.12 || highCurveRatio >= 0.28 ? "ramp" : (removalRatio >= 0.12 && cheapRatio >= 0.18 ? "interaction" : (drawRatio >= 0.1 ? "setup" : (cheapRatio >= 0.3 ? "tempo" : "balanced")))
  };
}

function assessHand(hand: HandCard[], deckProfile: DeckProfile): HandAssessment {
  const landCount = hand.filter((card) => card.isLand).length;
  const earlyPlayable = hand.some((card) => !card.isLand && card.manaValue <= 2);
  const ramp = hand.some((card) => card.isRamp);
  const draw = hand.some((card) => card.isDraw);
  const available = new Set(hand.filter((card) => card.isLand).flatMap((card) => card.colors.filter((entry) => entry !== "c" && entry !== "colorless")));
  const needed = new Set(hand.filter((card) => !card.isLand && card.manaValue <= 3).flatMap((card) => card.colors.filter((entry) => entry !== "c" && entry !== "colorless")));
  const colorAccess = [...needed].every((color) => available.has(color));
  const cheapActionCount = hand.filter((card) => !card.isLand && card.manaValue <= 3).length;
  const reactiveCount = hand.filter((card) => card.isRemoval).length;
  const clunkyCount = hand.filter((card) => !card.isLand && card.manaValue >= 5).length;
  const fitsEarlyCurve = deckProfile.cheapRatio >= 0.35 ? cheapActionCount >= 2 || (cheapActionCount >= 1 && ramp) : (deckProfile.earlyPlan === "ramp" ? ramp || cheapActionCount >= 1 : cheapActionCount >= 1);
  const supportsEarlyPlan = deckProfile.earlyPlan === "ramp" ? ramp || (earlyPlayable && draw) : (deckProfile.earlyPlan === "interaction" ? reactiveCount >= 1 || earlyPlayable : (deckProfile.earlyPlan === "setup" ? draw || ramp : (deckProfile.earlyPlan === "tempo" ? cheapActionCount >= 2 : earlyPlayable || ramp || draw)));
  const actionCount = hand.filter((card) => !card.isLand).length;
  const mixedHand = landCount >= 2 && landCount <= 4 && actionCount >= 3 && actionCount <= 5;
  const tooReactive = reactiveCount >= 2 && !ramp && !draw && cheapActionCount <= 1;
  const tooSlow = !earlyPlayable && !ramp && clunkyCount >= 2;
  const tooClunky = clunkyCount >= 3 || (clunkyCount >= 2 && landCount <= 2);
  let score = 0;
  if (landCount >= 2 && landCount <= 4) score += 2; else if (landCount === 0 || landCount >= 6) score -= 2;
  score += earlyPlayable ? 1 : -1;
  score += colorAccess ? 1 : -1;
  score += fitsEarlyCurve ? 1 : -1;
  score += supportsEarlyPlan ? 1 : -1;
  score += mixedHand ? 1 : -1;
  if (ramp) score += 1;
  if (draw) score += 1;
  if (tooReactive) score -= 1;
  if (tooSlow) score -= 1;
  if (tooClunky) score -= 1;

  const signals = [
    supportsEarlyPlan ? (deckProfile.earlyPlan === "ramp" ? "Supports the deck's early ramp plan." : deckProfile.earlyPlan === "interaction" ? "Supports the deck's early interaction plan." : deckProfile.earlyPlan === "setup" ? "Supports the deck's early setup plan." : deckProfile.earlyPlan === "tempo" ? "Supports the deck's fast-start plan." : "Supports the deck's early plan.") : "Does not line up cleanly with the deck's early plan.",
    mixedHand ? `${landCount} lands and ${actionCount} action cards is a healthy mix.` : "The land-to-action mix is awkward for a clean opener.",
    !colorAccess ? "Early colors are awkward for the cheap part of the hand." : tooReactive ? "The hand is a bit too reactive for this deck." : tooSlow ? "The hand is too slow to affect the early turns well." : tooClunky ? "Too many expensive cards make the opener clunky." : ramp ? "Early ramp gives the hand a useful accelerator." : draw ? "Early card flow gives the hand a safety valve." : "There is at least one useful early piece to deploy on time."
  ];

  return {
    verdict: score >= 5 ? "Keep" : (score >= 2 ? "Borderline" : "Mulligan"),
    landCount,
    hasEarlyPlayable: earlyPlayable,
    hasColorAccess: colorAccess,
    hasRamp: ramp,
    hasDraw: draw,
    fitsEarlyCurve,
    note: [
      deckProfile.earlyPlan === "ramp" ? "This deck usually wants mana development early." : deckProfile.earlyPlan === "interaction" ? "This deck usually wants to manage the early board." : deckProfile.earlyPlan === "setup" ? "This deck usually wants setup or card flow early." : deckProfile.earlyPlan === "tempo" ? "This deck usually wants to commit pressure early." : "This deck usually wants a balanced opener.",
      landCount < 2 ? "The mana is light." : landCount > 4 ? "The mana is heavy." : mixedHand ? "The land and action mix is stable." : "The land and action mix is a little awkward.",
      !colorAccess ? "Your early colors do not line up cleanly." : supportsEarlyPlan ? "This hand lines up with the deck's early plan." : (ramp || draw || earlyPlayable) ? "This hand has some play, but it misses the deck's best early pattern." : "",
      tooReactive ? "It leans reactive without enough proactive setup." : tooSlow ? "It is slower than this deck usually wants." : tooClunky ? "Too many expensive cards make it clunky." : (ramp && draw) ? "Ramp and card draw both help it recover well." : ramp ? "Ramp helps it catch up on speed." : draw ? "Card draw gives it a reasonable fallback." : ""
    ].filter(Boolean).join(" "),
    signals: signals.slice(0, 3)
  };
}

export function buildMulliganSample(cards: StoredCard[]): MulliganSample {
  const deckPool = expandDeck(cards);
  if (deckPool.length < 7) {
    return {
      cards: deckPool.map((card) => ({ name: card.name, manaValue: card.manaValue, type: card.type, isLand: card.isLand, imageUrl: card.imageUrl })),
      verdict: "Mulligan",
      landCount: deckPool.filter((card) => card.isLand).length,
      hasEarlyPlayable: deckPool.some((card) => !card.isLand && card.manaValue <= 2),
      hasColorAccess: false,
      hasRamp: deckPool.some((card) => card.isRamp),
      hasDraw: deckPool.some((card) => card.isDraw),
      fitsEarlyCurve: false,
      note: "Need at least 7 cards in the deck to sample a full opening hand.",
      signals: ["The deck needs at least 7 cards before Mulligan Coach can evaluate a real opener."]
    };
  }

  const hand = shuffle(deckPool).slice(0, 7);
  const assessment = assessHand(hand, buildDeckProfile(deckPool));

  return {
    cards: hand.map((card) => ({ name: card.name, manaValue: card.manaValue, type: card.type, isLand: card.isLand, imageUrl: card.imageUrl })),
    verdict: assessment.verdict,
    landCount: assessment.landCount,
    hasEarlyPlayable: assessment.hasEarlyPlayable,
    hasColorAccess: assessment.hasColorAccess,
    hasRamp: assessment.hasRamp,
    hasDraw: assessment.hasDraw,
    fitsEarlyCurve: assessment.fitsEarlyCurve,
    note: assessment.note,
    signals: assessment.signals
  };
}
