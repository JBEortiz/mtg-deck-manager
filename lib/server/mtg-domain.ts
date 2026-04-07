import "server-only";

import { countPendingMetadataCards, findReusableMetadata, mergeReusableMetadata, needsMetadataEnrichment, resolveMetadataLookup, selectMetadataEnrichmentCandidates } from "@/lib/card-metadata";
import { inferCommanderFromResolvedEntries, parseDecklistText } from "@/lib/decklist-import";
import { resolveImportEntriesWithFallback } from "@/lib/import-resolution";
import type { Card, CardLookupResult, Deck, DeckBudgetUpgradeSuggestion, DeckBudgetUpgrades, DeckCutSuggestion, DeckCutSuggestions, DeckPortfolio, DeckStats, DeckValueTracker, ImportResult } from "@/lib/types";
import { buildDeckPassport, buildMulliganSample, classifyDeckCardRoles } from "@/lib/server/mtg-analytics";
import { ensureDeckValueTracker, ensurePortfolioValueTracker, initializeDeckValueTracking, refreshDeckValueSnapshotsInDatabase } from "@/lib/server/deck-value";
import { createOwnedDeckRecord, ensureOwnedResource, filterOwnedResources, notFoundForOwnership, requireAuthenticatedOwner } from "@/lib/server/deck-ownership";
import { readDatabase, type StoredCard, type StoredDeck, withDatabaseWrite } from "@/lib/server/mtg-store";
import { getCardByExactName, getCardByFuzzyName, getCardPricesByCollection, searchCards as searchScryfallCards } from "@/lib/scryfall/server";

export type ApiRouteError = {
  body: Record<string, unknown>;
  status: number;
};

function normalize(value: string | null | undefined): string {
  return value == null ? "" : value.trim().toLowerCase();
}

function normalizeNullable(value: unknown): string | null {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const next = normalizeNullable(value);
    if (next) {
      return next;
    }
  }
  return null;
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

function springErrorBody(status: number, error: string, path: string) {
  return {
    timestamp: new Date().toISOString(),
    status,
    error,
    path
  };
}

function badRequest(path: string): ApiRouteError {
  return {
    status: 400,
    body: springErrorBody(400, "Bad Request", path)
  };
}

function notFound(path: string): ApiRouteError {
  return notFoundForOwnership(path);
}

function deckValidationError(errors: string[]): ApiRouteError {
  return {
    status: 400,
    body: {
      message: "Deck validation failed",
      errors
    }
  };
}

function isCommanderDeck(format: string) {
  return normalize(format) === "commander";
}

function validateCommanderCardTotal(deck: { format: string }, cards: Array<{ quantity: number }>) {
  if (!isCommanderDeck(deck.format)) {
    return null;
  }

  const totalCards = cards.reduce((total, card) => total + quantity(card), 0);
  return totalCards > 100 ? ["Commander decks cannot exceed 100 total cards."] : null;
}

function deckCards(cards: StoredCard[], deckId: number) {
  return cards.filter((card) => card.deckId === deckId).sort((left, right) => left.id - right.id);
}

function hasColor(colors: string, expectedColor: string) {
  return splitColors(colors).some((part) => part.toLowerCase() === expectedColor.trim().toLowerCase());
}

function isLandCard(card: { type: string }) {
  return normalize(card.type).includes("land");
}

function isCreatureCard(card: { type: string }) {
  return normalize(card.type).includes("creature");
}

function commanderColorSet(cards: StoredCard[], commanderName: string) {
  const commander = cards.find((card) => normalize(card.name) === normalize(commanderName));
  return new Set(splitColors(commander?.colors).map((color) => color.toUpperCase()));
}

function overlapCount(values: Set<string>, candidate: string[]) {
  return candidate.reduce((count, color) => count + (values.has(color.toUpperCase()) ? 1 : 0), 0);
}

function buildCutSuggestionSummary(deck: StoredDeck, suggestions: DeckCutSuggestion[], warnings: string[]) {
  if (suggestions.length === 0) {
    return deck.commander
      ? `No hay un primer corte claro para ${deck.commander} con las heuristicas MVP actuales.`
      : "No hay un primer corte claro con las heuristicas MVP actuales.";
  }

  const topCategories = new Set(suggestions.slice(0, 3).map((suggestion) => suggestion.category));
  const themes: string[] = [];
  if (topCategories.has("curve-pressure") || topCategories.has("too-slow")) {
    themes.push("la curva alta");
  }
  if (topCategories.has("redundant-effect")) {
    themes.push("efectos redundantes");
  }
  if (topCategories.has("win-more")) {
    themes.push("cartas de cierre que sobran");
  }
  if (topCategories.has("low-synergy")) {
    themes.push("piezas poco alineadas con el plan");
  }
  if (topCategories.has("low-impact") || topCategories.has("weak-standalone-value")) {
    themes.push("slots de impacto bajo");
  }

  const summaryTheme = themes.length > 0 ? themes.join(", ") : "las piezas menos eficientes";
  const warningSuffix = warnings.length > 0 ? " La confianza baja un poco porque el deck sigue incompleto o con datos limitados." : "";
  return `Los primeros cortes apuntan sobre todo a ${summaryTheme}, empezando por las cartas que presionan mas la consistencia del plan.${warningSuffix}`;
}

function buildDeckCutSuggestions(deck: StoredDeck, cards: StoredCard[]): DeckCutSuggestions {
  const warnings: string[] = [];
  const totalCards = cards.reduce((total, card) => total + quantity(card), 0);
  if (cards.length < 20 || totalCards < 60) {
    warnings.push("El deck parece incompleto; los cortes tienen menos contexto del normal.");
  }

  const passport = buildDeckPassport(deck, cards);
  const commanderColors = commanderColorSet(cards, deck.commander);
  const nonLands = cards.filter((card) => !isLandCard(card));
  const highCurveCount = nonLands.filter((card) => card.manaValue >= 5).reduce((sum, card) => sum + quantity(card), 0);
  const heavyCurve = nonLands.length > 0 && highCurveCount >= Math.max(12, Math.floor(totalCards * 0.18));
  const suggestions = nonLands
    .map((card) => {
      const roles = classifyDeckCardRoles(card);
      const colors = splitColors(card.colors).map((color) => color.toUpperCase());
      const colorOverlap = commanderColors.size > 0 ? overlapCount(commanderColors, colors) : colors.length;
      let score = 0;
      let category: DeckCutSuggestion["category"] = "low-impact";
      let reason = "No empuja con suficiente fuerza el plan principal comparado con otras cartas del deck.";

      if (card.manaValue >= 7) {
        score += 6;
        category = "too-slow";
        reason = `Cuesta ${card.manaValue} mana y pide demasiado tiempo antes de impactar la partida.`;
      } else if (card.manaValue >= 5 && heavyCurve) {
        score += 4;
        category = "curve-pressure";
        reason = `La curva ya va cargada arriba y esta pieza de coste ${card.manaValue} aprieta mas los turnos medios.`;
      }

      if ((roles.finisher && passport.roles.finishers >= 5 && card.manaValue >= 5)) {
        score += 4;
        category = "win-more";
        reason = "El deck ya tiene suficientes cierres; esta carta parece mas un lujo que una necesidad.";
      } else if ((roles.ramp && passport.roles.ramp >= 11 && card.manaValue >= 3)) {
        score += 4;
        category = "redundant-effect";
        reason = "Ya vas sobrado de ramp y este slot es de los menos eficientes para esa funcion.";
      } else if ((roles.draw && passport.roles.draw >= 10 && card.manaValue >= 4)) {
        score += 4;
        category = "redundant-effect";
        reason = "El deck ya tiene bastante robo; esta pieza es de las primeras en sobrar.";
      } else if (((roles.removal || roles.boardWipe) && (passport.roles.removal + passport.roles.boardWipes) >= 11 && card.manaValue >= 4)) {
        score += 4;
        category = "redundant-effect";
        reason = "La interaccion ya esta cubierta y esta respuesta es de las menos eficientes.";
      } else if ((roles.protection && passport.roles.protection >= 5 && card.manaValue >= 3)) {
        score += 3;
        category = "redundant-effect";
        reason = "Hay proteccion suficiente y esta copia adicional aporta menos que otros slots.";
      }

      if (!roles.ramp && !roles.draw && !roles.removal && !roles.boardWipe && !roles.protection && !roles.finisher) {
        if (card.manaValue >= 4 && !isCreatureCard(card)) {
          score += 3;
          category = "weak-standalone-value";
          reason = "No destaca por eficiencia ni por rol claro; es de los slots mas faciles de convertir en algo mejor.";
        } else {
          score += 2;
          category = "low-impact";
          reason = "Su impacto aislado parece bajo frente a otras cartas del mismo hueco.";
        }
      }

      if (commanderColors.size > 0 && colors.length > 0 && colorOverlap === 0 && card.manaValue >= 3) {
        score += 3;
        category = "low-synergy";
        reason = "Aporta poco a la identidad principal del comandante y compite por un slot que podria ser mas sinergico.";
      }

      if (card.quantity > 1 && card.manaValue >= 4) {
        score += 1;
      }

      return {
        cardId: card.id,
        cardName: card.name,
        quantity: card.quantity,
        manaValue: card.manaValue,
        category,
        reason,
        score
      } satisfies DeckCutSuggestion;
    })
    .filter((suggestion) => suggestion.score > 0)
    .sort((left, right) => right.score - left.score || right.manaValue - left.manaValue || left.cardName.localeCompare(right.cardName))
    .slice(0, 10);

  return {
    deckId: deck.id,
    commander: deck.commander,
    generatedAt: new Date().toISOString(),
    status: suggestions.length > 0 ? (warnings.length > 0 ? "partial" : "ready") : "unavailable",
    summary: buildCutSuggestionSummary(deck, suggestions, warnings),
    warnings,
    suggestions
  };
}

type UpgradeRole = "ramp" | "draw" | "removal" | "protection" | "consistency";

type UpgradeCandidate = {
  name: string;
  roles: UpgradeRole[];
  colors: string[];
  minBudgetUsd?: number;
  improves: string;
  reasonTemplate: string;
};

const UPGRADE_CANDIDATES: UpgradeCandidate[] = [
  { name: "Arcane Signet", roles: ["ramp", "consistency"], colors: [], improves: "Mejora el ramp temprano", reasonTemplate: "Es una mejora limpia de mana para casi cualquier deck de Commander y acelera el plan sin pedir condiciones." },
  { name: "Fellwar Stone", roles: ["ramp", "consistency"], colors: [], improves: "Acelera sin perder flexibilidad", reasonTemplate: "Suele dar mana util en multiplayer y mejora el desarrollo sin subir mucho la curva." },
  { name: "Liquimetal Torque", roles: ["ramp"], colors: [], improves: "Suma una roca eficiente de coste dos", reasonTemplate: "Aprieta mejor los primeros turnos que varias rocas de coste tres o mas." },
  { name: "Thought Vessel", roles: ["ramp", "draw"], colors: [], improves: "Combina aceleracion y margen de mano", reasonTemplate: "Mejora la curva y da un extra util en partidas largas sin ocupar un slot caro." },
  { name: "Wayfarer's Bauble", roles: ["ramp", "consistency"], colors: [], improves: "Hace mas estable el arranque", reasonTemplate: "Es una forma barata de estabilizar salidas lentas y arreglar turnos tempranos." },
  { name: "Swiftfoot Boots", roles: ["protection", "consistency"], colors: [], improves: "Protege al comandante y a las mejores amenazas", reasonTemplate: "Da proteccion inmediata a piezas importantes y mejora la consistencia del plan central." },
  { name: "Lightning Greaves", roles: ["protection", "consistency"], colors: [], minBudgetUsd: 4, improves: "Proteccion inmediata para el plan central", reasonTemplate: "Reduce el riesgo de perder tempo al desplegar comandante o payoff clave." },
  { name: "Mind Stone", roles: ["ramp", "draw"], colors: [], improves: "Rampa temprano y se recicla luego", reasonTemplate: "Es una roca mas eficiente que muchos aceleradores lentos y mantiene valor en late game." },
  { name: "Night's Whisper", roles: ["draw", "consistency"], colors: ["B"], improves: "Sube el robo eficiente", reasonTemplate: "Da cartas por poco mana y ayuda a que el deck no se vacie demasiado pronto." },
  { name: "Sign in Blood", roles: ["draw"], colors: ["B"], improves: "Mejora la consistencia de robo", reasonTemplate: "Convierte dos mana en dos cartas y suele ser una mejora clara sobre slots negros flojos." },
  { name: "Read the Bones", roles: ["draw"], colors: ["B"], improves: "Filtra y recupera gas", reasonTemplate: "Da seleccion mas cartas y compensa manos o robos mediocres." },
  { name: "Ponder", roles: ["draw", "consistency"], colors: ["U"], improves: "Aumenta la consistencia", reasonTemplate: "Mejora mucho la calidad de los primeros robos y ayuda a encadenar mejores turnos." },
  { name: "Preordain", roles: ["draw", "consistency"], colors: ["U"], improves: "Ajusta draws y curva", reasonTemplate: "Su eficiencia hace que los turnos tempranos sean mas fluidos y consistentes." },
  { name: "Arcane Denial", roles: ["removal", "consistency"], colors: ["U"], improves: "Anade interaccion barata", reasonTemplate: "Da una respuesta flexible a bajo coste y mejora la capacidad de no quedarse vendido." },
  { name: "Pongify", roles: ["removal"], colors: ["U"], improves: "Sube la calidad del removal", reasonTemplate: "Convierte un slot de respuesta mediocre en una interaccion mucho mas eficiente." },
  { name: "Rapid Hybridization", roles: ["removal"], colors: ["U"], improves: "Interaccion mas eficiente", reasonTemplate: "Gana tempo frente a amenazas grandes y abarata el paquete de respuestas." },
  { name: "Swords to Plowshares", roles: ["removal"], colors: ["W"], improves: "Removal premium de coste uno", reasonTemplate: "Es una mejora muy clara de eficiencia para cualquier paquete blanco de respuestas." },
  { name: "Path to Exile", roles: ["removal"], colors: ["W"], improves: "Respuesta barata y fiable", reasonTemplate: "Aprieta mejor el coste de interaccion que muchas alternativas mas lentas." },
  { name: "Generous Gift", roles: ["removal"], colors: ["W"], improves: "Respuesta universal", reasonTemplate: "Amplia mucho el rango de permanentes que el deck puede contestar." },
  { name: "Nature's Lore", roles: ["ramp", "consistency"], colors: ["G"], improves: "Rampa de tierras mas limpia", reasonTemplate: "Mejora la base de mana y suele superar a varios aceleradores mas lentos." },
  { name: "Farseek", roles: ["ramp", "consistency"], colors: ["G"], improves: "Arregla mana y curva", reasonTemplate: "Hace mas estables los colores y reduce salidas torpes." },
  { name: "Rampant Growth", roles: ["ramp"], colors: ["G"], improves: "Acelera la salida", reasonTemplate: "Convierte un turno dos en un desarrollo mucho mas fiable para el resto de la partida." },
  { name: "Beast Within", roles: ["removal"], colors: ["G"], improves: "Interaccion mas amplia", reasonTemplate: "Da una respuesta muy flexible y mejora la capacidad del deck de desatascar mesas complicadas." },
  { name: "Heroic Intervention", roles: ["protection"], colors: ["G"], minBudgetUsd: 8, improves: "Proteccion de alto impacto", reasonTemplate: "Protege una mesa desarrollada y evita perder turnos enteros frente a removal masivo." },
  { name: "Faithless Looting", roles: ["draw", "consistency"], colors: ["R"], improves: "Filtra manos flojas", reasonTemplate: "Ayuda a encontrar mejores piezas antes y reduce robos muertos en midgame." },
  { name: "Abrade", roles: ["removal"], colors: ["R"], improves: "Mejora el removal flexible", reasonTemplate: "Resuelve criaturas o artefactos por poco mana y mejora la eficiencia del paquete rojo." },
  { name: "Chaos Warp", roles: ["removal"], colors: ["R"], improves: "Amplia el alcance de las respuestas", reasonTemplate: "Permite contestar permanentes que normalmente se atascan en rojo." }
];

function buildUpgradeSummary(result: DeckBudgetUpgrades) {
  if (result.suggestions.length === 0) {
    return `No encontre una tanda corta de upgrades fiables para un presupuesto de ${formatBudgetUsd(result.requestedBudgetUsd)}.`;
  }

  return `Propongo ${result.suggestions.length} upgrade(s) que caben dentro de ${formatBudgetUsd(result.requestedBudgetUsd)} y priorizan consistencia, eficiencia y mejores roles para el plan del deck.`;
}

function formatBudgetUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function colorIdentitySet(deck: StoredDeck, cards: StoredCard[]) {
  const colors = new Set<string>();
  for (const card of cards) {
    for (const color of splitColors(card.colors)) {
      const normalizedColor = color.toUpperCase();
      if (normalizedColor && normalizedColor !== "C" && normalizedColor !== "COLORLESS") {
        colors.add(normalizedColor);
      }
    }
  }

  const commander = cards.find((card) => normalize(card.name) === normalize(deck.commander));
  for (const color of splitColors(commander?.colors)) {
    const normalizedColor = color.toUpperCase();
    if (normalizedColor && normalizedColor !== "C" && normalizedColor !== "COLORLESS") {
      colors.add(normalizedColor);
    }
  }

  return colors;
}

function candidateFitsDeck(candidate: UpgradeCandidate, deckColors: Set<string>, existingNames: Set<string>) {
  if (existingNames.has(normalize(candidate.name))) {
    return false;
  }

  if (candidate.colors.length === 0) {
    return true;
  }

  return candidate.colors.every((color) => deckColors.has(color));
}

function candidatePriority(candidate: UpgradeCandidate, passport: ReturnType<typeof buildDeckPassport>, heavyCurve: boolean) {
  let score = 0;

  if (candidate.roles.includes("ramp") && passport.roles.ramp < 8) {
    score += 5;
  } else if (candidate.roles.includes("ramp") && passport.roles.ramp < 10) {
    score += 3;
  }

  if (candidate.roles.includes("draw") && passport.roles.draw < 7) {
    score += 5;
  } else if (candidate.roles.includes("draw") && passport.roles.draw < 9) {
    score += 3;
  }

  if (candidate.roles.includes("removal") && (passport.roles.removal + passport.roles.boardWipes) < 8) {
    score += 5;
  } else if (candidate.roles.includes("removal") && (passport.roles.removal + passport.roles.boardWipes) < 10) {
    score += 3;
  }

  if (candidate.roles.includes("protection") && passport.roles.protection < 3) {
    score += 4;
  }

  if (candidate.roles.includes("consistency")) {
    score += heavyCurve ? 3 : 1;
  }

  return score;
}

function suggestedCutForUpgrade(cutSuggestions: DeckCutSuggestions, candidate: UpgradeCandidate) {
  const firstByCategory = (categories: DeckCutSuggestion["category"][]) => (
    cutSuggestions.suggestions.find((suggestion) => categories.includes(suggestion.category))?.cardName ?? null
  );

  if (candidate.roles.includes("ramp")) {
    return firstByCategory(["too-slow", "curve-pressure", "redundant-effect"]);
  }

  if (candidate.roles.includes("draw")) {
    return firstByCategory(["weak-standalone-value", "low-impact", "redundant-effect"]);
  }

  if (candidate.roles.includes("removal")) {
    return firstByCategory(["low-impact", "redundant-effect", "weak-standalone-value"]);
  }

  if (candidate.roles.includes("protection")) {
    return firstByCategory(["win-more", "curve-pressure", "low-impact"]);
  }

  return firstByCategory(["low-impact", "weak-standalone-value", "curve-pressure"]);
}

function commanderCoverUrl(deck: StoredDeck, cards: StoredCard[], allCards: StoredCard[] = cards) {
  const commanderName = normalize(resolveDeckCommanderName(deck, cards));

  if (commanderName) {
    for (const card of allCards) {
      const image = firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl);
      if (normalize(card.name) === commanderName && image) {
        return image;
      }
    }
  }

  return null;
}

function firstAvailableCoverUrl(cards: StoredCard[]) {
  for (const card of cards) {
    const image = firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl);
    if (image) {
      return image;
    }
  }

  return null;
}

function toDeckCoverUrl(deck: StoredDeck, cards: StoredCard[], allCards: StoredCard[] = cards) {
  return commanderCoverUrl(deck, cards, allCards) ?? firstAvailableCoverUrl(cards);
}

function inferCommanderFromCards(deck: StoredDeck, cards: StoredCard[]) {
  if (!isCommanderDeck(deck.format)) {
    return null;
  }

  const legendaryCandidates = cards.filter((card) => {
    if (quantity(card) !== 1) {
      return false;
    }

    const typeLine = normalize(card.type);
    return typeLine.includes("legendary") && (typeLine.includes("creature") || typeLine.includes("planeswalker"));
  });

  return legendaryCandidates.length === 1 ? legendaryCandidates[0]?.name ?? null : null;
}

function resolveDeckCommanderName(deck: StoredDeck, cards: StoredCard[]) {
  return firstNonBlank(deck.commander, inferCommanderFromCards(deck, cards));
}

function toDeckResponse(deck: StoredDeck, cards: StoredCard[]): Deck {
  return {
    id: deck.id,
    ownerUserId: deck.ownerUserId,
    name: deck.name,
    format: deck.format,
    commander: deck.commander,
    createdAt: deck.createdAt,
    deckCoverUrl: toDeckCoverUrl(deck, cards)
  };
}

async function toDeckResponseWithCommanderCover(deck: StoredDeck, cards: StoredCard[], allCards: StoredCard[]): Promise<Deck> {
  const preferredCommanderCover = commanderCoverUrl(deck, cards, allCards);
  const fallbackCover = firstAvailableCoverUrl(cards);
  if (preferredCommanderCover || !normalize(deck.commander)) {
    return {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt,
      deckCoverUrl: preferredCommanderCover ?? fallbackCover
    };
  }

  try {
    const commanderLookup = await getCardByExactName(deck.commander);
    return {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt,
      deckCoverUrl: firstNonBlank(commanderLookup.imageNormal, commanderLookup.imageSmall) ?? fallbackCover
    };
  } catch {
    return {
      id: deck.id,
      ownerUserId: deck.ownerUserId,
      name: deck.name,
      format: deck.format,
      commander: deck.commander,
      createdAt: deck.createdAt,
      deckCoverUrl: fallbackCover
    };
  }
}

function toDeckListResponse(deck: StoredDeck, cards: StoredCard[]): Deck {
  return {
    ...toDeckResponse(deck, cards),
    totalCardCount: cards.reduce((total, card) => total + quantity(card), 0),
    cardPreview: cards.slice(0, 5).map((card) => `${card.quantity}x ${card.name}`)
  };
}

function toCardResponse(card: StoredCard): Card {
  return {
    id: card.id,
    name: card.name,
    manaValue: card.manaValue,
    type: card.type,
    colors: card.colors,
    quantity: card.quantity,
    scryfallId: card.scryfallId,
    imageSmall: card.imageSmall,
    imageNormal: card.imageNormal,
    imageUrl: card.imageUrl
  };
}

async function resolveCardMetadata(cardName: string, existing: Omit<StoredCard, "deckId" | "id">) {
  const resolved = {
    ...existing,
    imageUrl: firstNonBlank(existing.imageNormal, existing.imageSmall, existing.imageUrl)
  };

  if (!needsMetadataEnrichment({
    ...resolved,
    name: cardName
  })) {
    return resolved;
  }

  try {
    const metadataLookup = await resolveMetadataLookup(cardName, async (name, mode) => (
      mode === "exact" ? getCardByExactName(name) : getCardByFuzzyName(name)
    ));

    if (!metadataLookup.ok) {
      return resolved;
    }

    const lookup = metadataLookup.lookup;
    return {
      ...resolved,
      manaValue: resolved.manaValue > 0 ? resolved.manaValue : lookup.manaValue,
      type: normalize(resolved.type) && normalize(resolved.type) !== "unknown" ? resolved.type : lookup.type,
      colors: normalize(resolved.colors) !== "colorless" && normalize(resolved.colors) !== "c" ? resolved.colors : lookup.colors,
      scryfallId: resolved.scryfallId ?? normalizeNullable(lookup.scryfallId),
      imageSmall: resolved.imageSmall ?? normalizeNullable(lookup.imageSmall),
      imageNormal: resolved.imageNormal ?? normalizeNullable(lookup.imageNormal),
      imageUrl: firstNonBlank(resolved.imageNormal ?? lookup.imageNormal, resolved.imageSmall ?? lookup.imageSmall, resolved.imageUrl)
    };
  } catch {
    return resolved;
  }
}

function reuseStoredCardMetadata(
  target: Omit<StoredCard, "deckId" | "id">,
  allCards: StoredCard[],
  options?: {
    excludeDeckId?: number;
    excludeCardIds?: number[];
  }
) {
  const excludedIds = new Set(options?.excludeCardIds ?? []);
  const candidates = allCards.filter((candidate) => {
    if (options?.excludeDeckId != null && candidate.deckId === options.excludeDeckId) {
      return false;
    }

    return !excludedIds.has(candidate.id);
  });
  const reusable = findReusableMetadata(target, candidates);
  return reusable ? mergeReusableMetadata(target, reusable) : target;
}

function mergeLookupMetadata(card: StoredCard, lookup: CardLookupResult) {
  return {
    manaValue: lookup.manaValue,
    type: lookup.type,
    colors: lookup.colors || card.colors,
    scryfallId: normalizeNullable(lookup.scryfallId),
    imageSmall: normalizeNullable(lookup.imageSmall),
    imageNormal: normalizeNullable(lookup.imageNormal),
    imageUrl: firstNonBlank(lookup.imageNormal, lookup.imageSmall, card.imageUrl)
  };
}

async function opportunisticallyEnrichDeckMetadata(cards: StoredCard[], allCards: StoredCard[], commanderName?: string | null, limit = 0, concurrency = 8) {
  const effectiveLimit = limit > 0 ? limit : cards.length;
  const candidates = selectMetadataEnrichmentCandidates(cards, commanderName, effectiveLimit);
  const failuresByReason: Record<string, number> = {};
  const results: Array<{ card: StoredCard; metadata?: ReturnType<typeof mergeLookupMetadata>; failureReason?: string }> = new Array(candidates.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= candidates.length) {
        return;
      }

      const card = candidates[currentIndex];
      const localMetadata = reuseStoredCardMetadata(card, allCards, {
        excludeDeckId: card.deckId,
        excludeCardIds: [card.id]
      });

      if (
        localMetadata.manaValue !== card.manaValue
        || localMetadata.type !== card.type
        || localMetadata.colors !== card.colors
        || localMetadata.scryfallId !== card.scryfallId
        || localMetadata.imageSmall !== card.imageSmall
        || localMetadata.imageNormal !== card.imageNormal
        || localMetadata.imageUrl !== card.imageUrl
      ) {
        results[currentIndex] = {
          card,
          metadata: {
            manaValue: localMetadata.manaValue,
            type: localMetadata.type,
            colors: localMetadata.colors,
            scryfallId: localMetadata.scryfallId,
            imageSmall: localMetadata.imageSmall,
            imageNormal: localMetadata.imageNormal,
            imageUrl: localMetadata.imageUrl
          }
        };
        continue;
      }

      const metadataLookup = await resolveMetadataLookup(card.name, async (name, mode) => (
        mode === "exact" ? getCardByExactName(name) : getCardByFuzzyName(name)
      )).catch(() => null);

      if (!metadataLookup || !metadataLookup.ok) {
        results[currentIndex] = {
          card,
          failureReason: metadataLookup?.failure.code ?? "lookup_failed"
        };
        continue;
      }

      results[currentIndex] = {
        card,
        metadata: mergeLookupMetadata(card, metadataLookup.lookup)
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, candidates.length)) }, () => worker()));

  let enrichedCount = 0;

  for (const result of results) {
    if (!result) {
      continue;
    }

    if (result.failureReason) {
      failuresByReason[result.failureReason] = (failuresByReason[result.failureReason] ?? 0) + 1;
      continue;
    }

    const nextMetadata = result.metadata;
    const card = result.card;
    if (!nextMetadata) {
      continue;
    }

    const changed = nextMetadata.manaValue !== card.manaValue
      || nextMetadata.type !== card.type
      || nextMetadata.colors !== card.colors
      || nextMetadata.scryfallId !== card.scryfallId
      || nextMetadata.imageSmall !== card.imageSmall
      || nextMetadata.imageNormal !== card.imageNormal
      || nextMetadata.imageUrl !== card.imageUrl;

    if (!changed) {
      continue;
    }

    card.manaValue = nextMetadata.manaValue;
    card.type = nextMetadata.type;
    card.colors = nextMetadata.colors;
    card.scryfallId = nextMetadata.scryfallId;
    card.imageSmall = nextMetadata.imageSmall;
    card.imageNormal = nextMetadata.imageNormal;
    card.imageUrl = nextMetadata.imageUrl;
    enrichedCount += 1;
  }

  return {
    enrichedCount,
    pendingCount: countPendingMetadataCards(cards),
    failuresByReason
  };
}

async function loadDeckWithEnrichment(deckId: number, ownerUserId?: number) {
  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return null;
    }

    const cards = deckCards(database.cards, deckId);
    const enrichment = await opportunisticallyEnrichDeckMetadata(cards, database.cards, deck.commander);
    return { deck, cards, allCards: database.cards, enrichment };
  });
}

function inferTypeForImportedCard(cardName: string) {
  const normalizedName = normalize(cardName);
  const basicLandNames = new Set([
    "plains",
    "island",
    "swamp",
    "mountain",
    "forest",
    "wastes",
    "snow-covered plains",
    "snow-covered island",
    "snow-covered swamp",
    "snow-covered mountain",
    "snow-covered forest",
    "snow-covered wastes"
  ]);
  return basicLandNames.has(normalizedName) ? "Basic Land" : "Unknown";
}

function inferColorsForImportedCard(cardName: string) {
  switch (normalize(cardName)) {
    case "plains":
    case "snow-covered plains":
      return "W";
    case "island":
    case "snow-covered island":
      return "U";
    case "swamp":
    case "snow-covered swamp":
      return "B";
    case "mountain":
    case "snow-covered mountain":
      return "R";
    case "forest":
    case "snow-covered forest":
      return "G";
    default:
      return "Colorless";
  }
}

async function findDeck(deckId: number) {
  const database = await readDatabase();
  return {
    database,
    deck: database.decks.find((entry) => entry.id === deckId),
    cards: deckCards(database.cards, deckId)
  };
}

async function findOwnedDeck(deckId: number, ownerUserId: number) {
  const { database, deck, cards } = await findDeck(deckId);
  const ownedDeck = ensureOwnedResource(deck, ownerUserId, `/api/decks/${deckId}`);
  if ("status" in ownedDeck) {
    return null;
  }

  return { database, deck: ownedDeck, cards };
}

function findExistingCardForImport(deckCardsInDeck: StoredCard[], lookup: CardLookupResult, importedName: string) {
  const normalizedImportedName = normalize(importedName);

  return deckCardsInDeck.find((card) => {
    if (lookup.scryfallId && card.scryfallId && normalize(card.scryfallId) === normalize(lookup.scryfallId)) {
      return true;
    }

    return normalize(card.name) === normalizedImportedName;
  });
}

export function toRouteResponse(result: unknown, status = 200): Response {
  if (result && typeof result === "object" && "status" in result && "body" in result) {
    const routeError = result as ApiRouteError;
    return Response.json(routeError.body, { status: routeError.status });
  }

  if (typeof result === "string") {
    return new Response(result, {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }

  return Response.json(result, { status });
}

export async function getHealthText() {
  await readDatabase();
  return "ok";
}

export async function listDecks(ownerUserId?: number): Promise<Deck[]> {
  const database = await readDatabase();
  const visibleDecks = filterOwnedResources(database.decks, ownerUserId);

  const sortedDecks = [...visibleDecks]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return Promise.all(sortedDecks.map(async (deck) => {
    const cards = deckCards(database.cards, deck.id);
    const deckResponse = await toDeckResponseWithCommanderCover(deck, cards, database.cards);

    return {
      ...deckResponse,
      totalCardCount: cards.reduce((total, card) => total + quantity(card), 0),
      cardPreview: cards.slice(0, 5).map((card) => `${card.quantity}x ${card.name}`)
    };
  }));
}

export async function createDeck(payload: unknown, path = "/api/decks", ownerUserId?: number): Promise<Deck | ApiRouteError> {
  if (!payload || typeof payload !== "object") {
    return badRequest(path);
  }

  const body = payload as { commander?: unknown; format?: unknown; name?: unknown };
  const name = normalizeNullable(body.name);
  const format = normalizeNullable(body.format);

  if (!name || !format) {
    return badRequest(path);
  }

  const authenticatedOwner = requireAuthenticatedOwner(ownerUserId);
  if (typeof authenticatedOwner !== "number") {
    return authenticatedOwner;
  }

  return withDatabaseWrite(async (database) => {
    const ownerExists = database.users.some((user) => user.id === authenticatedOwner);
    if (!ownerExists) {
      return {
        status: 404,
        body: {
          message: "Deck owner was not found."
        }
      } satisfies ApiRouteError;
    }

    const deck: StoredDeck = createOwnedDeckRecord({
      id: database.nextDeckId++,
      ownerUserId: authenticatedOwner,
      name,
      format,
      commander: normalizeNullable(body.commander) ?? "",
      createdAt: new Date().toISOString()
    });

    database.decks.push(deck);
    initializeDeckValueTracking(database, deck.id, "deck-create");
    return toDeckResponse(deck, []);
  });
}

export async function getDeck(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<Deck | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  return loadedDeck ? await toDeckResponseWithCommanderCover(loadedDeck.deck, loadedDeck.cards, loadedDeck.allCards) : notFound(path);
}

export async function updateDeck(deckId: number, payload: unknown, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<Deck | ApiRouteError> {
  if (!payload || typeof payload !== "object") {
    return badRequest(path);
  }

  const body = payload as { commander?: unknown; format?: unknown; name?: unknown };
  const name = normalizeNullable(body.name);
  const format = normalizeNullable(body.format);

  if (!name || !format) {
    return badRequest(path);
  }

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(path);
    }

    const cards = deckCards(database.cards, deckId);
    const errors = validateCommanderCardTotal({ format }, cards);
    if (errors) {
      return deckValidationError(errors);
    }

    deck.name = name;
    deck.format = format;
    deck.commander = normalizeNullable(body.commander) ?? "";
    return toDeckResponse(deck, cards);
  });
}

export async function deleteDeck(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<null | ApiRouteError> {
  return withDatabaseWrite((database) => {
    const deckIndex = database.decks.findIndex((entry) => entry.id === deckId);
    if (deckIndex < 0) {
      return notFound(path);
    }

    const deck = database.decks[deckIndex];
    if (ownerUserId != null && deck.ownerUserId !== ownerUserId) {
      return notFound(path);
    }

    const removedWishlistIds = new Set(
      database.wishlistItems
        .filter((item) => item.deckId === deckId)
        .map((item) => item.id)
    );
    const removedDeckSnapshotIds = new Set(
      database.deckValueSnapshots
        .filter((snapshot) => snapshot.deckId === deckId)
        .map((snapshot) => snapshot.id)
    );
    const removedDeckCardIds = new Set(
      database.cards
        .filter((card) => card.deckId === deckId)
        .map((card) => card.id)
    );

    database.decks.splice(deckIndex, 1);
    database.cards = database.cards.filter((card) => card.deckId !== deckId);
    database.wishlistItems = database.wishlistItems.filter((item) => item.deckId !== deckId);
    database.deckCardPurchases = database.deckCardPurchases.filter((purchase) => purchase.deckId !== deckId);
    database.deckValueSnapshots = database.deckValueSnapshots.filter((snapshot) => snapshot.deckId !== deckId);
    database.cardValueSnapshots = database.cardValueSnapshots.filter((snapshot) => (
      snapshot.deckId !== deckId
      && !removedDeckSnapshotIds.has(snapshot.deckSnapshotId)
      && (snapshot.cardId == null || !removedDeckCardIds.has(snapshot.cardId))
    ));

    // Safety cleanup in case a previous corrupted row points to now-deleted wishlist items.
    database.deckCardPurchases = database.deckCardPurchases.map((purchase) => (
      purchase.wishlistItemId != null && removedWishlistIds.has(purchase.wishlistItemId)
        ? {
            ...purchase,
            wishlistItemId: null
          }
        : purchase
    ));

    return null;
  });
}

export async function listDeckCards(deckId: number, searchParams: URLSearchParams, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<Card[] | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  if (!loadedDeck) {
    return notFound(path);
  }

  let filtered = [...loadedDeck.cards];
  const name = searchParams.get("name");
  const type = searchParams.get("type");
  const color = searchParams.get("color");
  const sortBy = searchParams.get("sortBy");
  const direction = searchParams.get("direction");

  if (name && name.trim()) {
    const search = name.trim().toLowerCase();
    filtered = filtered.filter((card) => normalize(card.name).includes(search));
  }

  if (type && type.trim()) {
    filtered = filtered.filter((card) => normalize(card.type) === type.trim().toLowerCase());
  }

  if (color && color.trim()) {
    filtered = filtered.filter((card) => hasColor(card.colors, color));
  }

  if (sortBy?.toLowerCase() === "name") {
    filtered.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  } else if (sortBy?.toLowerCase() === "manavalue") {
    filtered.sort((left, right) => left.manaValue - right.manaValue);
  }

  if (direction?.toLowerCase() === "desc" && (sortBy?.toLowerCase() === "name" || sortBy?.toLowerCase() === "manavalue")) {
    filtered.reverse();
  }

  return filtered.map(toCardResponse);
}

function parseCardPayload(payload: unknown, path: string): Omit<StoredCard, "deckId" | "id"> | ApiRouteError {
  if (!payload || typeof payload !== "object") {
    return badRequest(path);
  }

  const body = payload as { colors?: unknown; imageNormal?: unknown; imageSmall?: unknown; imageUrl?: unknown; manaValue?: unknown; name?: unknown; quantity?: unknown; scryfallId?: unknown; type?: unknown };
  const name = normalizeNullable(body.name);
  const type = normalizeNullable(body.type);
  const colors = normalizeNullable(body.colors);
  const manaValue = typeof body.manaValue === "number" ? Math.trunc(body.manaValue) : Number.NaN;
  const quantityValue = typeof body.quantity === "number" ? Math.trunc(body.quantity) : Number.NaN;

  if (!name || !type || !colors || Number.isNaN(manaValue) || manaValue < 0 || Number.isNaN(quantityValue) || quantityValue < 1) {
    return badRequest(path);
  }

  return {
    name,
    manaValue,
    type,
    colors,
    quantity: quantityValue,
    scryfallId: normalizeNullable(body.scryfallId),
    imageSmall: normalizeNullable(body.imageSmall),
    imageNormal: normalizeNullable(body.imageNormal),
    imageUrl: normalizeNullable(body.imageUrl)
  };
}

export async function addDeckCard(deckId: number, payload: unknown, path = `/api/decks/${deckId}/cards`, ownerUserId?: number): Promise<Card | ApiRouteError> {
  const parsed = parseCardPayload(payload, path);
  if ("status" in parsed) {
    return parsed;
  }

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(`/api/decks/${deckId}`);
    }

    const errors = validateCommanderCardTotal(deck, [...deckCards(database.cards, deckId), { quantity: parsed.quantity }]);
    if (errors) {
      return deckValidationError(errors);
    }

    const metadata = reuseStoredCardMetadata(
      await resolveCardMetadata(parsed.name, parsed),
      database.cards,
      { excludeDeckId: deckId }
    );
    const card: StoredCard = {
      ...metadata,
      deckId,
      id: database.nextCardId++
    };

    database.cards.push(card);
    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "card-add",
        replaceEmptyBaseline: !database.cards.some((entry) => entry.deckId === deckId && entry.id !== card.id)
      });
    } catch {
      // Pricing refresh must not block card creation.
    }
    return toCardResponse(card);
  });
}

export async function updateDeckCard(deckId: number, cardId: number, payload: unknown, path = `/api/decks/${deckId}/cards/${cardId}`, ownerUserId?: number): Promise<Card | ApiRouteError> {
  const parsed = parseCardPayload(payload, path);
  if ("status" in parsed) {
    return parsed;
  }

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(`/api/decks/${deckId}`);
    }

    const card = database.cards.find((entry) => entry.deckId === deckId && entry.id === cardId);
    if (!card) {
      return notFound(path);
    }

    const errors = validateCommanderCardTotal(deck, [...deckCards(database.cards, deckId).filter((entry) => entry.id !== cardId), { quantity: parsed.quantity }]);
    if (errors) {
      return deckValidationError(errors);
    }

    Object.assign(
      card,
      reuseStoredCardMetadata(
        await resolveCardMetadata(parsed.name, parsed),
        database.cards,
        { excludeDeckId: deckId, excludeCardIds: [card.id] }
      )
    );
    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "card-update"
      });
    } catch {
      // Pricing refresh must not block card updates.
    }
    return toCardResponse(card);
  });
}

export async function deleteDeckCard(deckId: number, cardId: number, path = `/api/decks/${deckId}/cards/${cardId}`, ownerUserId?: number): Promise<null | ApiRouteError> {
  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(path);
    }

    const index = database.cards.findIndex((entry) => entry.deckId === deckId && entry.id === cardId);
    if (index < 0) {
      return notFound(path);
    }

    database.cards.splice(index, 1);
    database.cardValueSnapshots = database.cardValueSnapshots.map((snapshot) => (
      snapshot.cardId === cardId
        ? {
            ...snapshot,
            cardId: null
          }
        : snapshot
    ));
    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "card-delete"
      });
    } catch {
      // Pricing refresh must not block card deletions.
    }
    return null;
  });
}

export async function getDeckStats(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<DeckStats | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  if (!loadedDeck) {
    return notFound(path);
  }

  const { cards } = loadedDeck;
  const byColor: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const manaCurve: Record<string, number> = {};
  let totalCards = 0;

  for (const card of cards) {
    totalCards += quantity(card);
    byType[card.type] = (byType[card.type] ?? 0) + quantity(card);
    manaCurve[String(card.manaValue)] = (manaCurve[String(card.manaValue)] ?? 0) + quantity(card);
    const colors = splitColors(card.colors);
    if (colors.length === 0) {
      byColor.Colorless = (byColor.Colorless ?? 0) + quantity(card);
    } else {
      for (const color of colors) {
        byColor[color] = (byColor[color] ?? 0) + quantity(card);
      }
    }
  }

  return { totalCards, byColor, byType, manaCurve };
}

export async function getDeckPassport(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number) {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  return loadedDeck ? buildDeckPassport(loadedDeck.deck, loadedDeck.cards) : notFound(path);
}

export async function getMulliganSample(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number) {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  return loadedDeck ? buildMulliganSample(loadedDeck.cards) : notFound(path);
}

export async function exportDecklist(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<string | ApiRouteError> {
  if (ownerUserId != null) {
    const ownedDeck = await findOwnedDeck(deckId, ownerUserId);
    if (!ownedDeck) {
      return notFound(path);
    }

    const commanderName = firstNonBlank(ownedDeck.deck.commander);
    const bodyLines = ownedDeck.cards
      .filter((card) => normalize(card.name) !== normalize(commanderName))
      .map((card) => `${card.quantity} ${card.name}`);

    if (isCommanderDeck(ownedDeck.deck.format) && commanderName) {
      return ["Commander", `1 ${commanderName}`, "", "Deck", ...bodyLines].join("\n");
    }

    return ownedDeck.cards.map((card) => `${card.quantity} ${card.name}`).join("\n");
  }

  const { deck, cards } = await findDeck(deckId);
  if (!deck) {
    return notFound(path);
  }

  const commanderName = firstNonBlank(deck.commander);
  const bodyLines = cards
    .filter((card) => normalize(card.name) !== normalize(commanderName))
    .map((card) => `${card.quantity} ${card.name}`);

  if (isCommanderDeck(deck.format) && commanderName) {
    return ["Commander", `1 ${commanderName}`, "", "Deck", ...bodyLines].join("\n");
  }

  return cards.map((card) => `${card.quantity} ${card.name}`).join("\n");
}

export async function importDecklist(deckId: number, payload: unknown, path = `/api/decks/${deckId}/import`, ownerUserId?: number): Promise<ImportResult | ApiRouteError> {
  if (!payload || typeof payload !== "object" || !normalizeNullable((payload as { decklistText?: unknown }).decklistText)) {
    return badRequest(path);
  }

  const decklistText = normalizeNullable((payload as { decklistText?: unknown }).decklistText) ?? "";

  return withDatabaseWrite(async (database) => {
    const deck = database.decks.find((entry) => entry.id === deckId);
    if (!deck || (ownerUserId != null && deck.ownerUserId !== ownerUserId)) {
      return notFound(`/api/decks/${deckId}`);
    }

    const cardsInDeck = deckCards(database.cards, deckId);
    const wasDeckEmptyBeforeImport = cardsInDeck.length === 0;
    const metadataEnrichment = await opportunisticallyEnrichDeckMetadata(cardsInDeck, database.cards, deck.commander);

    const preview = parseDecklistText(decklistText);
    const errors: ImportResult["errors"] = [...preview.unrecognizedLines];
    const importableCards: Array<{
      lookup: CardLookupResult | null;
      name: string;
      quantity: number;
      resolvedBy: "exact" | "normalized-exact" | "fuzzy" | "fallback-inferred";
      fallbackFailure?: { code: string; status: number; message: string } | undefined;
    }> = [];
    let unresolvedLookupLines = 0;
    let normalizedExactLookups = 0;
    let fuzzyLookups = 0;
    let fallbackImportedCards = 0;
    const lookupFailuresByReason: Record<string, number> = {};
    const resolvedEntries = await resolveImportEntriesWithFallback(
      preview.recognizedEntries,
      async (name, mode) => (mode === "exact" ? getCardByExactName(name) : getCardByFuzzyName(name))
    );

    for (const resolvedEntry of resolvedEntries) {
      if (resolvedEntry.ok) {
        if (resolvedEntry.resolvedBy === "normalized-exact") {
          normalizedExactLookups += 1;
        } else if (resolvedEntry.resolvedBy === "fuzzy") {
          fuzzyLookups += 1;
        } else if (resolvedEntry.resolvedBy === "fallback-inferred") {
          fallbackImportedCards += resolvedEntry.entry.quantity;
          const reason = resolvedEntry.failure?.code ?? "lookup_failed";
          lookupFailuresByReason[reason] = (lookupFailuresByReason[reason] ?? 0) + resolvedEntry.entry.lineNumbers.length;
        }

        importableCards.push({
          lookup: resolvedEntry.lookup ?? null,
          name: resolvedEntry.entry.name,
          quantity: resolvedEntry.entry.quantity,
          resolvedBy: resolvedEntry.resolvedBy,
          fallbackFailure: resolvedEntry.failure
        });
        continue;
      }

      for (let index = 0; index < resolvedEntry.entry.lineNumbers.length; index += 1) {
        unresolvedLookupLines += 1;
        const reason = resolvedEntry.failure.code ?? "lookup_failed";
        lookupFailuresByReason[reason] = (lookupFailuresByReason[reason] ?? 0) + 1;
        errors.push({
          kind: "lookup",
          line: resolvedEntry.entry.lineNumbers[index] ?? 0,
          message: resolvedEntry.failure.message,
          rawLine: resolvedEntry.entry.rawLines[index] ?? resolvedEntry.entry.name,
          lookupCode: resolvedEntry.failure.code,
          lookupStatus: resolvedEntry.failure.status
        });
      }
    }

    const commanderErrors = validateCommanderCardTotal(deck, [...deckCards(database.cards, deckId), ...importableCards.map((card) => ({ quantity: card.quantity }))]);
    if (commanderErrors) {
      return deckValidationError(commanderErrors);
    }

    const createdCards: ImportResult["createdCards"] = [];
    const updatedCards: ImportResult["updatedCards"] = [];
    let importedCount = 0;

    for (const parsedCard of importableCards) {
      const resolvedLookup = parsedCard.lookup;
      const importedName = resolvedLookup?.name ?? parsedCard.name;
      const existingCard = resolvedLookup ? findExistingCardForImport(cardsInDeck, resolvedLookup, parsedCard.name) : cardsInDeck.find((card) => normalize(card.name) === normalize(parsedCard.name)) ?? null;
      const metadata = {
        scryfallId: normalizeNullable(resolvedLookup?.scryfallId),
        imageSmall: normalizeNullable(resolvedLookup?.imageSmall),
        imageNormal: normalizeNullable(resolvedLookup?.imageNormal),
        imageUrl: firstNonBlank(resolvedLookup?.imageNormal, resolvedLookup?.imageSmall)
      };
      const nextType = resolvedLookup?.type || inferTypeForImportedCard(importedName);
      const nextColors = resolvedLookup?.colors || inferColorsForImportedCard(importedName);
      const nextManaValue = resolvedLookup?.manaValue ?? 0;
      const reusedMetadata = reuseStoredCardMetadata(
        {
          name: importedName,
          manaValue: nextManaValue,
          type: nextType,
          colors: nextColors,
          quantity: parsedCard.quantity,
          scryfallId: metadata.scryfallId,
          imageSmall: metadata.imageSmall,
          imageNormal: metadata.imageNormal,
          imageUrl: metadata.imageUrl
        },
        database.cards,
        {
          excludeDeckId: deckId
        }
      );

      if (existingCard) {
        existingCard.name = importedName;
        existingCard.manaValue = reusedMetadata.manaValue;
        existingCard.type = reusedMetadata.type;
        existingCard.colors = reusedMetadata.colors;
        existingCard.quantity += parsedCard.quantity;
        existingCard.scryfallId = reusedMetadata.scryfallId;
        existingCard.imageSmall = reusedMetadata.imageSmall;
        existingCard.imageNormal = reusedMetadata.imageNormal;
        existingCard.imageUrl = reusedMetadata.imageUrl;
        importedCount += parsedCard.quantity;
        updatedCards.push({ id: existingCard.id, name: existingCard.name, quantity: existingCard.quantity });
        continue;
      }

      const card: StoredCard = {
        id: database.nextCardId++,
        deckId,
        name: importedName,
        manaValue: reusedMetadata.manaValue,
        type: reusedMetadata.type,
        colors: reusedMetadata.colors,
        quantity: parsedCard.quantity,
        scryfallId: reusedMetadata.scryfallId,
        imageSmall: reusedMetadata.imageSmall,
        imageNormal: reusedMetadata.imageNormal,
        imageUrl: reusedMetadata.imageUrl
      };

      database.cards.push(card);
      cardsInDeck.push(card);
      importedCount += parsedCard.quantity;
      createdCards.push({ id: card.id, name: card.name, quantity: card.quantity });
    }

    const importedCommanderInference = inferCommanderFromResolvedEntries(
      deck.format,
      preview.commanderEntries,
      importableCards.map((card) => ({
        name: card.lookup?.name ?? card.name,
        originalName: card.name,
        quantity: card.quantity,
        type: card.lookup?.type ?? inferTypeForImportedCard(card.name)
      }))
    );
    const inferredCommander = inferCommanderFromCards(deck, cardsInDeck);
    const nextCommanderName = firstNonBlank(deck.commander, importedCommanderInference.commanderName, inferredCommander);
    const commanderDetection = !isCommanderDeck(deck.format)
      ? "No aplica a este formato."
      : (deck.commander
          ? "Se mantiene el comandante ya guardado."
          : importedCommanderInference.commanderName
            ? importedCommanderInference.detection
            : inferredCommander
                ? "Comandante inferido desde la lista importada."
                : "Sin comandante fiable; la portada usa el primer arte disponible como fallback.");

    if (isCommanderDeck(deck.format) && nextCommanderName) {
      deck.commander = nextCommanderName;
    }

    const metadataPendingCards = countPendingMetadataCards(cardsInDeck);

    try {
      await refreshDeckValueSnapshotsInDatabase(database, deckId, {
        source: "deck-import",
        replaceEmptyBaseline: wasDeckEmptyBeforeImport
      });
    } catch {
      // Import success should not be reverted by a pricing refresh failure.
    }

    return {
      importedCount,
      createdCards,
      updatedCards,
      errors,
      pipeline: {
        detectedSource: preview.detectedSourceLabel,
        totalPastedLines: preview.totalPastedLines,
        ignoredBlankLines: preview.ignoredBlankLines,
        ignoredSectionLines: preview.ignoredSectionLines,
        ignoredLines: preview.ignoredBlankLines + preview.ignoredSectionLines,
        parsedLines: preview.parsedLines,
        recognizedCards: importableCards.length,
        unresolvedLines: errors.length,
        parseFailures: preview.unrecognizedLines.length,
        unresolvedCardLookups: unresolvedLookupLines,
        normalizedExactLookups,
        fuzzyLookups,
        fallbackImportedCards,
        metadataEnrichedCards: metadataEnrichment.enrichedCount,
        metadataPendingCards,
        lookupFailuresByReason,
        metadataEnrichmentFailuresByReason: metadataEnrichment.failuresByReason,
        duplicatesConsolidated: preview.duplicatesConsolidated,
        actuallyImportedCards: importedCount,
        skippedOrFailedImports: errors.length,
        commanderDetection
      }
    };
  });
}

export async function searchCards(query: string, limit: number): Promise<CardLookupResult[]> {
  return searchScryfallCards(query, limit);
}

export async function getDeckValue(deckId: number, path = `/api/decks/${deckId}`, ownerUserId?: number): Promise<DeckValueTracker | ApiRouteError> {
  const ownedDeck = ownerUserId != null ? await findOwnedDeck(deckId, ownerUserId) : await findDeck(deckId);
  if (!ownedDeck?.deck) {
    return notFound(path);
  }

  const tracker = await ensureDeckValueTracker(deckId);
  return tracker ?? notFound(path);
}

export async function getDeckCutSuggestions(deckId: number, path = `/api/decks/${deckId}/assistant/cuts`, ownerUserId?: number): Promise<DeckCutSuggestions | ApiRouteError> {
  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  if (!loadedDeck) {
    return notFound(path);
  }

  return buildDeckCutSuggestions(loadedDeck.deck, loadedDeck.cards);
}

export async function getDeckBudgetUpgrades(
  deckId: number,
  budgetUsd: number,
  path = `/api/decks/${deckId}/assistant/upgrades`,
  ownerUserId?: number
): Promise<DeckBudgetUpgrades | ApiRouteError> {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return badRequest(path);
  }

  const loadedDeck = await loadDeckWithEnrichment(deckId, ownerUserId);
  if (!loadedDeck) {
    return notFound(path);
  }

  const { deck, cards } = loadedDeck;
  const passport = buildDeckPassport(deck, cards);
  const cutSuggestions = buildDeckCutSuggestions(deck, cards);
  const deckColors = colorIdentitySet(deck, cards);
  const existingNames = new Set(cards.map((card) => normalize(card.name)));
  const nonLands = cards.filter((card) => !isLandCard(card));
  const totalCards = cards.reduce((total, card) => total + quantity(card), 0);
  const highCurveCount = nonLands.filter((card) => card.manaValue >= 5).reduce((sum, card) => sum + quantity(card), 0);
  const heavyCurve = nonLands.length > 0 && highCurveCount >= Math.max(12, Math.floor(totalCards * 0.18));

  const rankedCandidates = UPGRADE_CANDIDATES
    .filter((candidate) => candidateFitsDeck(candidate, deckColors, existingNames))
    .map((candidate) => ({
      candidate,
      score: candidatePriority(candidate, passport, heavyCurve)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.name.localeCompare(right.candidate.name))
    .slice(0, 10);

  const warnings: string[] = [];
  if (cards.length < 20 || totalCards < 60) {
    warnings.push("El deck parece incompleto; las sugerencias de upgrade tienen menos contexto.");
  }

  if (rankedCandidates.length === 0) {
    return {
      deckId,
      commander: deck.commander,
      requestedBudgetUsd: Number(budgetUsd.toFixed(2)),
      totalEstimatedSpendUsd: 0,
      remainingBudgetUsd: Number(budgetUsd.toFixed(2)),
      generatedAt: new Date().toISOString(),
      status: "unavailable",
      summary: `No encontre upgrades MVP claros para ${formatBudgetUsd(budgetUsd)} con el estado actual del deck.`,
      warnings,
      suggestions: []
    };
  }

  let lookups;
  let lookupWarnings = 0;
  try {
    lookups = await getCardPricesByCollection(rankedCandidates.map((entry) => ({ name: entry.candidate.name })));
  } catch {
    lookups = { data: [], notFound: rankedCandidates.map((entry) => ({ name: entry.candidate.name })) };
    lookupWarnings = rankedCandidates.length;
  }

  const lookupByName = new Map(lookups.data.map((entry) => [normalize(entry.name), entry]));
  const viableSuggestions: DeckBudgetUpgradeSuggestion[] = [];
  let runningSpend = 0;
  let unresolvedPrices = 0;

  for (const entry of rankedCandidates) {
    const lookup = lookupByName.get(normalize(entry.candidate.name)) ?? null;
    const estimatedPriceUsd = lookup?.priceUsd ?? null;
    const minBudgetUsd = entry.candidate.minBudgetUsd ?? 0;
    if (budgetUsd < minBudgetUsd) {
      continue;
    }

    if (estimatedPriceUsd == null) {
      unresolvedPrices += 1;
      continue;
    }

    const nextSpend = Number((runningSpend + estimatedPriceUsd).toFixed(2));
    if (nextSpend > budgetUsd + 0.01) {
      continue;
    }

    viableSuggestions.push({
      cardName: lookup?.name ?? entry.candidate.name,
      estimatedPriceUsd: estimatedPriceUsd == null ? null : Number(estimatedPriceUsd.toFixed(2)),
      suggestedCutCardName: suggestedCutForUpgrade(cutSuggestions, entry.candidate),
      improves: entry.candidate.improves,
      reason: entry.candidate.reasonTemplate,
      imageUrl: firstNonBlank(lookup?.imageNormal, lookup?.imageSmall)
    });
    runningSpend = nextSpend;

    if (viableSuggestions.length >= 5) {
      break;
    }
  }

  if (lookupWarnings > 0 || unresolvedPrices > 0) {
    warnings.push("Parte del precio actual no estuvo disponible; la lista se limito a upgrades con coste fiable.");
  }

  const result: DeckBudgetUpgrades = {
    deckId,
    commander: deck.commander,
    requestedBudgetUsd: Number(budgetUsd.toFixed(2)),
    totalEstimatedSpendUsd: Number(runningSpend.toFixed(2)),
    remainingBudgetUsd: Number((budgetUsd - runningSpend).toFixed(2)),
    generatedAt: new Date().toISOString(),
    status: viableSuggestions.length > 0 ? (warnings.length > 0 ? "partial" : "ready") : "unavailable",
    summary: "",
    warnings,
    suggestions: viableSuggestions
  };
  result.summary = buildUpgradeSummary(result);
  return result;
}

export async function getDeckPortfolio(ownerUserId: number): Promise<DeckPortfolio> {
  return ensurePortfolioValueTracker(ownerUserId);
}

