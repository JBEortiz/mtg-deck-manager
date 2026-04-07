import "server-only";

import { detectAssistantIntent } from "@/lib/assistant/intentDetection";
import { findBestRulesMatch } from "@/lib/assistant/matcher";
import { getCardByFuzzyName, searchCards } from "@/lib/scryfall/server";
import type { CardLookupResult, RulesHelperResult } from "@/lib/types";

function cleanCardToken(value: string) {
  return value.trim().replace(/^["'`]|["'`]$/g, "");
}

export function parseInteractionPair(query: string): { left: string; right: string } | null {
  const normalized = query.trim();
  if (!normalized) {
    return null;
  }

  const betweenMatch = normalized.match(/interaction between\s+(.+?)\s+and\s+(.+)/i);
  if (betweenMatch) {
    return {
      left: cleanCardToken(betweenMatch[1]),
      right: cleanCardToken(betweenMatch[2])
    };
  }

  const interactMatch = normalized.match(/how do(?:es)?\s+(.+?)\s+(?:and|with)\s+(.+?)\s+interact/i);
  if (interactMatch) {
    return {
      left: cleanCardToken(interactMatch[1]),
      right: cleanCardToken(interactMatch[2])
    };
  }

  const withMatch = normalized.match(/(.+?)\s+with\s+(.+)/i);
  if (withMatch) {
    return {
      left: cleanCardToken(withMatch[1]),
      right: cleanCardToken(withMatch[2])
    };
  }

  return null;
}

function buildInteractionSummary(left: CardLookupResult, right: CardLookupResult) {
  return `Revisa prioridad, objetivos y texto Oracle de ${left.name} y ${right.name}. Si ambas cartas usan la pila, el orden de resolucion cambia el resultado.`;
}

function historyNote(intent: RulesHelperResult["intent"]) {
  if (intent === "rules") {
    return "Respuesta basada en reglas generales y palabras clave del juego.";
  }
  if (intent === "interaction") {
    return "No se usa contexto de deck. Solo reglas generales + cartas consultadas.";
  }
  return "Busqueda ligera en Scryfall para ayudarte a ubicar cartas rapido.";
}

export async function resolveRulesHelperQuery(query: string): Promise<RulesHelperResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Escribe una consulta corta antes de enviar.");
  }

  const detectedIntent = detectAssistantIntent(trimmed);

  if (detectedIntent === "rules") {
    const match = findBestRulesMatch(trimmed);
    if (!match) {
      return {
        intent: "rules",
        query: trimmed,
        title: "Sin coincidencia clara",
        shortAnswer: "No encontre una regla exacta para esa frase.",
        note: "Prueba con terminos concretos como ward, cascade, equip, trample o hexproof.",
        stackUsage: null,
        cards: [],
        examples: [
          "does ward use the stack?",
          "what does cascade do?"
        ]
      };
    }

    return {
      intent: "rules",
      query: trimmed,
      title: match.entry.name,
      shortAnswer: match.entry.shortAnswer,
      note: `${match.entry.importantNuance} ${historyNote("rules")}`,
      stackUsage: match.entry.usesStack,
      cards: [],
      examples: [`${match.entry.exampleQuestion}`]
    };
  }

  if (detectedIntent === "interaction") {
    const pair = parseInteractionPair(trimmed);
    if (!pair) {
      return {
        intent: "interaction",
        query: trimmed,
        title: "Formato recomendado",
        shortAnswer: "Para interacciones, usa dos cartas en la misma consulta.",
        note: 'Ejemplo: "interaction between Rhystic Study and Smothering Tithe".',
        stackUsage: null,
        cards: [],
        examples: ["interaction between Sol Ring and Collector Ouphe"]
      };
    }

    const [left, right] = await Promise.all([
      getCardByFuzzyName(pair.left),
      getCardByFuzzyName(pair.right)
    ]);

    return {
      intent: "interaction",
      query: trimmed,
      title: `Interaccion: ${left.name} + ${right.name}`,
      shortAnswer: buildInteractionSummary(left, right),
      note: historyNote("interaction"),
      stackUsage: null,
      cards: [left, right],
      examples: ["how does deathtouch and trample work?"]
    };
  }

  const cards = await searchCards(trimmed, 6);
  return {
    intent: "card-lookup",
    query: trimmed,
    title: "Busqueda de cartas",
    shortAnswer: cards.length > 0
      ? `Encontre ${cards.length} coincidencia${cards.length === 1 ? "" : "s"} para tu consulta.`
      : "No hubo coincidencias con ese texto.",
    note: cards.length > 0
      ? historyNote("card-lookup")
      : "Prueba con nombre parcial, color, tipo o coste de mana.",
    stackUsage: null,
    cards,
    examples: ["white removal mana value 2", "blue instant draw"]
  };
}
