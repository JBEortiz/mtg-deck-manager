"use client";

import { FormEvent, useState } from "react";
import { fetchRulesHelperQuery } from "@/lib/api";
import type { RulesHelperResult } from "@/lib/types";

type ExamplePrompt = {
  label: string;
  prompt: string;
};

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  { label: "Keyword", prompt: "what does cascade do?" },
  { label: "Ability", prompt: "does ward use the stack?" },
  { label: "Interaccion", prompt: "interaction between Rhystic Study and Smothering Tithe" },
  { label: "Lookup", prompt: "white removal mana value 2" }
];

function stackUsageLabel(value: RulesHelperResult["stackUsage"]) {
  if (!value) {
    return null;
  }
  return value === "Yes" ? "Usa la pila: Si" : value === "No" ? "Usa la pila: No" : "Usa la pila: Depende";
}

function intentLabel(value: RulesHelperResult["intent"]) {
  if (value === "rules") {
    return "Reglas";
  }
  if (value === "interaction") {
    return "Interaccion";
  }
  return "Cards";
}

function responseErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la consulta.";
}

export default function RulesHelperClient() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RulesHelperResult | null>(null);

  const ask = async (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      setError("Escribe una consulta corta antes de enviar.");
      setResult(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetchRulesHelperQuery(trimmed);
      setResult(response);
    } catch (nextError) {
      setResult(null);
      setError(responseErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void ask(query);
  };

  const onPickExample = (prompt: string) => {
    setQuery(prompt);
    void ask(prompt);
  };

  return (
    <section className="panel rules-assistant">
      <div className="rules-header">
        <h2>MTG Rules Helper</h2>
        <p className="muted">Consultas rapidas para reglas, habilidades, interacciones y busqueda ligera de cartas. Sin contexto de deck.</p>
      </div>

      <form className="rules-form" onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ejemplo: does ward use the stack?"
          aria-label="Consulta de reglas"
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Consultando..." : "Consultar"}
        </button>
      </form>

      <div className="rules-examples">
        <span>Consultas sugeridas</span>
        <div className="rules-chip-list">
          {EXAMPLE_PROMPTS.map((example) => (
            <button key={example.prompt} type="button" className="rules-chip" onClick={() => onPickExample(example.prompt)}>
              <strong>{example.label}</strong>
              <span>{example.prompt}</span>
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="muted">Buscando respuesta...</p>}
      {!loading && error && <p className="error">{error}</p>}
      {!loading && !error && !result && (
        <p className="muted">Escribe una duda corta y recibiras una respuesta breve y accionable.</p>
      )}

      {!loading && result && (
        <article className="rules-answer-card" aria-live="polite">
          <header className="rules-answer-header">
            <div>
              <h3>{result.title}</h3>
              <p className="muted">Consulta: {result.query}</p>
            </div>
            <span className="status-badge intent-badge">{intentLabel(result.intent)}</span>
          </header>

          <div className="rules-answer-grid">
            <div className="rules-answer-item">
              <h4>Respuesta</h4>
              <p>{result.shortAnswer}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Nota</h4>
              <p>{result.note}</p>
            </div>
          </div>

          {stackUsageLabel(result.stackUsage) && (
            <p className="rules-stack-row status-badge">{stackUsageLabel(result.stackUsage)}</p>
          )}

          {result.cards.length > 0 && (
            <div className="subsection">
              <div className="section-header-inline">
                <h4>Cartas relacionadas</h4>
                <span className="status-badge">{result.cards.length}</span>
              </div>
              <ul className="card-list">
                {result.cards.map((card) => (
                  <li key={`${card.scryfallId ?? card.name}`} className="card-row card-row-compact">
                    <div className="card-main">
                      <div className="card-title-row">
                        <strong className="card-name">{card.name}</strong>
                        <span className="card-mv">MV {card.manaValue}</span>
                      </div>
                      <p className="card-type">{card.type}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
