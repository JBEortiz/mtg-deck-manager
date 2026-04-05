"use client";

import { FormEvent, useMemo, useState } from "react";
import { findBestRulesMatch } from "@/lib/assistant/matcher";
import { type AssistantIntent, detectAssistantIntent } from "@/lib/assistant/intentDetection";
import { type AssistantCardSearchResult, searchCardsForAssistant } from "@/lib/assistant/cardSearch";
import type { RulesEntry } from "@/lib/assistant/rulesData";

type RulesAssistantAnswer = {
  intent: AssistantIntent;
  question: string;
  rulesEntry?: RulesEntry;
  cardSearch?: AssistantCardSearchResult;
  title: string;
  shortAnswer: string;
  why: string;
  importantNuance: string;
  example: string;
};

type ExamplePrompt = {
  label: string;
  prompt: string;
};

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  { label: "Ward", prompt: "does ward use the stack?" },
  { label: "Removal", prompt: "white removal mana value 2" },
  { label: "Reach", prompt: "green creatures with reach" },
  { label: "Deck Help", prompt: "what is this deck missing for early interaction?" }
];

const COLOR_LABELS: Record<string, string> = {
  W: "Blanco",
  U: "Azul",
  B: "Negro",
  R: "Rojo",
  G: "Verde",
  C: "Incoloro"
};

function splitColorCodes(colors: string): string[] {
  return colors
    .toUpperCase()
    .split(/[^A-Z]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

export default function AssistantClient() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RulesAssistantAnswer | null>(null);
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const intentLabel = useMemo(() => {
    if (!answer) {
      return "";
    }

    if (answer.intent === "rules") {
      return "Reglas";
    }

    if (answer.intent === "cards") {
      return "Cartas";
    }

    return "Deck";
  }, [answer]);

  const buildDeckPlaceholder = (query: string): RulesAssistantAnswer => ({
    intent: "deck",
    question: query,
    title: "Analisis de deck",
    shortAnswer: "He detectado una consulta de analisis de deck, pero esta fase todavia prioriza reglas, busqueda de cartas y los paneles del detalle del deck.",
    why: "Tu mensaje parece una pregunta de consistencia, mejoras, huecos o plan de juego.",
    importantNuance: "Para feedback del deck actual, el detalle del deck sigue siendo la mejor fuente porque ya integra Deck Passport y Mulligan Coach.",
    example: "Prueba: what is this deck missing for early interaction?"
  });

  const askQuestion = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Escribe una consulta antes de enviar.");
      setAnswer(null);
      return;
    }

    const detectedIntent = detectAssistantIntent(trimmed);
    setIsSearching(true);

    try {
      if (detectedIntent === "rules") {
        const match = findBestRulesMatch(trimmed);
        if (!match) {
          setError("Todavia no puedo resolver esa consulta de reglas. Prueba con palabras como ward, equip, trample, cascade o hexproof.");
          setAnswer(null);
          return;
        }

        setError("");
        setAnswer({
          intent: "rules",
          question: trimmed,
          rulesEntry: match.entry,
          title: match.entry.name,
          shortAnswer: match.entry.shortAnswer,
          why: match.entry.why,
          importantNuance: match.entry.importantNuance,
          example: `Q: ${match.entry.exampleQuestion} A: ${match.entry.exampleAnswer}`
        });
        return;
      }

      if (detectedIntent === "cards") {
        const result = await searchCardsForAssistant(trimmed);
        setError("");
        setAnswer({
          intent: "cards",
          question: trimmed,
          cardSearch: result,
          title: "Buscador de cartas",
          shortAnswer: result.summary,
          why: result.filters.length > 0 ? `Se detectaron filtros ${result.filters.join(", ")} y se consulto Scryfall.` : "Se consulto Scryfall a partir de tu texto.",
          importantNuance: result.note,
          example: result.matches[0] ? `${result.matches[0].card.name} (MV ${result.matches[0].card.manaValue})` : "Prueba: blue counterspell mana value 2"
        });
        return;
      }

      setError("");
      setAnswer(buildDeckPlaceholder(trimmed));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo completar la consulta ahora mismo.");
      setAnswer(null);
    } finally {
      setIsSearching(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void askQuestion(question);
  };

  const onSelectExample = (example: string) => {
    setQuestion(example);
    void askQuestion(example);
  };

  const stackUsage = answer?.rulesEntry?.usesStack ?? null;
  const stackClass = stackUsage ? `stack-${stackUsage.toLowerCase()}` : "";

  return (
    <section className="panel rules-assistant">
      <div className="rules-header">
        <h2>Asistente</h2>
        <p className="muted">Una sola entrada para reglas, busqueda de cartas y clasificacion basica de consultas sobre decks.</p>
      </div>

      <form className="rules-form" onSubmit={onSubmit}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Pregunta por reglas, cartas o analisis ligero del deck..."
          aria-label="Consulta del asistente"
        />
        <button className="btn" type="submit" disabled={isSearching}>
          {isSearching ? "Buscando..." : "Consultar"}
        </button>
      </form>

      <div className="rules-examples">
        <span>Ejemplos</span>
        <div className="rules-chip-list">
          {EXAMPLE_PROMPTS.map((example) => (
            <button key={example.prompt} type="button" className="rules-chip" onClick={() => onSelectExample(example.prompt)}>
              <strong>{example.label}</strong>
              <span>{example.prompt}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {answer && (
        <article className="rules-answer-card" aria-live="polite">
          <header className="rules-answer-header">
            <div>
              <h3>{answer.title}</h3>
              <p className="muted">Consulta: {answer.question}</p>
            </div>
            <span className={`status-badge intent-badge intent-${answer.intent}`}>{intentLabel}</span>
          </header>

          {stackUsage && <p className={`rules-stack-row status-badge ${stackClass}`}>Usa la pila: {stackUsage}</p>}

          <div className="rules-answer-grid">
            <div className="rules-answer-item">
              <h4>Respuesta corta</h4>
              <p>{answer.shortAnswer}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Por que</h4>
              <p>{answer.why}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Matiz importante</h4>
              <p>{answer.importantNuance}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Ejemplo</h4>
              <p>{answer.example}</p>
            </div>
          </div>

          {answer.intent === "cards" && answer.cardSearch && (
            <div className="subsection">
              <div className="section-header-inline">
                <h4>Coincidencias de cartas</h4>
                <span className="status-badge">{answer.cardSearch.matches.length} resultado(s)</span>
              </div>
              {answer.cardSearch.matches.length === 0 ? (
                <p className="muted">{answer.cardSearch.note}</p>
              ) : (
                <ul className="card-list">
                  {answer.cardSearch.matches.map((match) => {
                    const colors = splitColorCodes(match.card.colors);
                    const image = firstNonBlank(match.card.imageNormal, match.card.imageSmall);

                    return (
                      <li key={`${match.card.scryfallId ?? match.card.name}`} className="card-row">
                        {image ? (
                          <img className="card-thumb assistant-card-thumb" src={image} alt={match.card.name} loading="lazy" />
                        ) : (
                          <div className="card-thumb-placeholder assistant-card-thumb">Sin imagen</div>
                        )}
                        <div className="card-main">
                          <div className="card-title-row">
                            <strong className="card-name">{match.card.name}</strong>
                            <span className="card-mv">MV {match.card.manaValue}</span>
                          </div>
                          <p className="card-type">{match.card.type}</p>
                          <p className="muted">{match.reasons.length > 0 ? match.reasons.join(" | ") : "Coincidencia por relevancia"}</p>
                        </div>
                        <div className="card-actions">
                          <span className="status-badge status-ok">Score {match.score}</span>
                          <div className="card-color-row">
                            {colors.length > 0 ? (
                              colors.map((color) => (
                                <span key={`${match.card.name}-${color}`} className={`color-chip color-${color}`}>
                                  {COLOR_LABELS[color] ?? color}
                                </span>
                              ))
                            ) : (
                              <span className="color-chip color-unknown">Sin color</span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </article>
      )}
    </section>
  );
}
