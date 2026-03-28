import { FormEvent, useMemo, useState } from "react";
import { RulesEntry } from "../rules/rulesData";
import { findBestRulesMatch } from "../rules/matcher";
import { AssistantIntent, detectAssistantIntent } from "../rules/intentDetection";
import { AssistantCardSearchResult, searchCardsForAssistant } from "../rules/cardSearch";

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

const EXAMPLE_PROMPTS = [
  "does ward use the stack?",
  "white removal mana value 2",
  "green creatures with reach",
  "artifact ramp cost 2"
];

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless"
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

function RulesAssistant() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RulesAssistantAnswer | null>(null);
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const intentLabel = useMemo(() => {
    if (!answer) {
      return "";
    }

    if (answer.intent === "rules") {
      return "Rules";
    }

    if (answer.intent === "cards") {
      return "Cards";
    }

    return "Deck";
  }, [answer]);

  const buildDeckPlaceholder = (query: string): RulesAssistantAnswer => ({
    intent: "deck",
    question: query,
    title: "Deck Analysis Assistant",
    shortAnswer: "Deck intent detected. I will provide deck feedback from your current list here.",
    why: "Your request looks like analysis, gaps, upgrades, or consistency questions.",
    importantNuance: "This preview currently routes intent only. Next step is reading your active deck/cards and producing targeted recommendations.",
    example: "Try: 'what is this deck missing for early interaction?'"
  });

  const askQuestion = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Write a request first.");
      setAnswer(null);
      return;
    }

    const detectedIntent = detectAssistantIntent(trimmed);
    setIsSearching(true);

    try {
      if (detectedIntent === "rules") {
        const match = findBestRulesMatch(trimmed);
        if (!match) {
          setError("I could not match that rules query yet. Try keywords like ward, equip, trample, cascade, or hexproof.");
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
          title: "Card Finder",
          shortAnswer: result.summary,
          why: result.filters.length > 0
            ? `Matched ${result.filters.join(", ")} and queried Scryfall.`
            : "Queried Scryfall from your request.",
          importantNuance: result.note,
          example: result.matches[0]
            ? `${result.matches[0].card.name} (MV ${result.matches[0].card.manaValue})`
            : "Try: 'blue counterspell mana value 2'."
        });
        return;
      }

      setError("");
      setAnswer(buildDeckPlaceholder(trimmed));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not complete that request right now.");
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
        <h2>Assistant</h2>
        <p className="muted">One input for rules help, card search requests, and deck analysis prompts.</p>
      </div>

      <form className="rules-form" onSubmit={onSubmit}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask anything: rules, cards, or deck analysis..."
          aria-label="Assistant request"
        />
        <button className="btn" type="submit" disabled={isSearching}>
          {isSearching ? "Searching..." : "Ask"}
        </button>
      </form>

      <div className="rules-examples">
        <span>Examples</span>
        <div className="rules-chip-list">
          {EXAMPLE_PROMPTS.map((example) => (
            <button key={example} type="button" className="rules-chip" onClick={() => onSelectExample(example)}>
              {example}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {answer && (
        <article className="rules-answer-card" aria-live="polite">
          <header className="rules-answer-header">
            <h3>{answer.title}</h3>
            <span className={`status-badge intent-badge intent-${answer.intent}`}>{intentLabel}</span>
          </header>

          {stackUsage && <p className={`rules-stack-row status-badge ${stackClass}`}>Uses the stack? {stackUsage}</p>}

          <div className="rules-answer-grid">
            <div className="rules-answer-item">
              <h4>Short answer</h4>
              <p>{answer.shortAnswer}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Why</h4>
              <p>{answer.why}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Important nuance</h4>
              <p>{answer.importantNuance}</p>
            </div>
            <div className="rules-answer-item">
              <h4>Example</h4>
              <p>{answer.example}</p>
            </div>
          </div>

          {answer.intent === "cards" && answer.cardSearch && (
            <div className="subsection">
              <h4>Card Matches</h4>
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
                          <div className="card-thumb-placeholder">No Image</div>
                        )}
                        <div className="card-main">
                          <div className="card-title-row">
                            <strong className="card-name">{match.card.name}</strong>
                            <span className="card-mv">MV {match.card.manaValue}</span>
                          </div>
                          <p className="card-type">{match.card.type}</p>
                          <p className="muted">{match.reasons.length > 0 ? match.reasons.join(" • ") : "Matched by query relevance"}</p>
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
                              <span className="color-chip color-unknown">No colors</span>
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

export default RulesAssistant;

