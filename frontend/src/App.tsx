import { FormEvent, useEffect, useState } from "react";

type Deck = {
  id: number;
  name: string;
  format: string;
  commander: string;
  createdAt: string;
};

type Card = {
  id: number;
  name: string;
  manaValue: number;
  type: string;
  colors: string;
  quantity: number;
};

type DeckStats = {
  totalCards: number;
  byColor: Record<string, number>;
  byType: Record<string, number>;
  manaCurve: Record<string, number>;
};

type ImportResult = {
  importedCount: number;
  createdCards: Array<{ id: number; name: string; quantity: number }>;
  errors: Array<{ line: number; message: string; rawLine: string }>;
};

type ApiErrorResponse = {
  message?: string;
  errors?: string[];
};

const API_BASE_URL = "http://localhost:8080/api";

async function parseApiError(response: Response): Promise<{ message: string; errors: string[] }> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const data = (await response.json()) as ApiErrorResponse;
    return {
      message: data.message ?? fallback,
      errors: Array.isArray(data.errors) ? data.errors : []
    };
  } catch {
    return { message: fallback, errors: [] };
  }
}

function App() {
  const [health, setHealth] = useState("");
  const [healthError, setHealthError] = useState("");

  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksError, setDecksError] = useState("");
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);

  const [cards, setCards] = useState<Card[]>([]);
  const [cardsError, setCardsError] = useState("");

  const [stats, setStats] = useState<DeckStats | null>(null);
  const [statsError, setStatsError] = useState("");

  const [name, setName] = useState("");
  const [format, setFormat] = useState("");
  const [commander, setCommander] = useState("");
  const [createDeckError, setCreateDeckError] = useState("");
  const [savingDeck, setSavingDeck] = useState(false);

  const [cardName, setCardName] = useState("");
  const [cardManaValue, setCardManaValue] = useState(0);
  const [cardType, setCardType] = useState("");
  const [cardColors, setCardColors] = useState("");
  const [cardQuantity, setCardQuantity] = useState(1);
  const [cardError, setCardError] = useState("");
  const [cardValidationErrors, setCardValidationErrors] = useState<string[]>([]);
  const [savingCard, setSavingCard] = useState(false);

  const [cardSearch, setCardSearch] = useState("");
  const [cardTypeFilter, setCardTypeFilter] = useState("");
  const [cardColorFilter, setCardColorFilter] = useState("");
  const [cardSort, setCardSort] = useState("name:asc");

  const [decklistText, setDecklistText] = useState("");
  const [importingDecklist, setImportingDecklist] = useState(false);
  const [importError, setImportError] = useState("");
  const [importValidationErrors, setImportValidationErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const loadDecks = async () => {
    setDecksError("");
    try {
      const response = await fetch(`${API_BASE_URL}/decks`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as Deck[];
      setDecks(data);
    } catch (err) {
      setDecks([]);
      setDecksError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const loadDeckCards = async (deckId: number) => {
    setCardsError("");
    try {
      const params = new URLSearchParams();
      if (cardSearch.trim()) {
        params.set("name", cardSearch.trim());
      }
      if (cardTypeFilter.trim()) {
        params.set("type", cardTypeFilter.trim());
      }
      if (cardColorFilter.trim()) {
        params.set("color", cardColorFilter.trim());
      }
      const [sortBy, direction] = cardSort.split(":");
      if (sortBy) {
        params.set("sortBy", sortBy);
      }
      if (direction) {
        params.set("direction", direction);
      }

      const query = params.toString();
      const response = await fetch(`${API_BASE_URL}/decks/${deckId}/cards${query ? `?${query}` : ""}`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as Card[];
      setCards(data);
    } catch (err) {
      setCards([]);
      setCardsError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const loadDeckStats = async (deckId: number) => {
    setStatsError("");
    try {
      const response = await fetch(`${API_BASE_URL}/decks/${deckId}/stats`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as DeckStats;
      setStats(data);
    } catch (err) {
      setStats(null);
      setStatsError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  useEffect(() => {
    void loadDecks();
  }, []);

  const checkHealth = async () => {
    setHealth("");
    setHealthError("");
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      setHealth(await response.text());
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const onCreateDeck = async (event: FormEvent) => {
    event.preventDefault();
    setCreateDeckError("");
    setSavingDeck(true);

    try {
      const response = await fetch(`${API_BASE_URL}/decks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, format, commander })
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const createdDeck = (await response.json()) as Deck;
      setName("");
      setFormat("");
      setCommander("");
      await loadDecks();
      setSelectedDeck(createdDeck);
      setCards([]);
      setStats(null);
      setImportResult(null);
      await loadDeckCards(createdDeck.id);
      await loadDeckStats(createdDeck.id);
    } catch (err) {
      setCreateDeckError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSavingDeck(false);
    }
  };

  const onSelectDeck = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/decks/${id}`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const deck = (await response.json()) as Deck;
      setSelectedDeck(deck);
      setImportResult(null);
      setImportValidationErrors([]);
      await loadDeckCards(deck.id);
      await loadDeckStats(deck.id);
    } catch (err) {
      setCreateDeckError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const onApplyCardFilters = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck) {
      return;
    }
    await loadDeckCards(selectedDeck.id);
  };

  const onResetCardFilters = async () => {
    setCardSearch("");
    setCardTypeFilter("");
    setCardColorFilter("");
    setCardSort("name:asc");

    if (!selectedDeck) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/decks/${selectedDeck.id}/cards?sortBy=name&direction=asc`);
    if (!response.ok) {
      setCards([]);
      setCardsError(`Request failed with status ${response.status}`);
      return;
    }
    const data = (await response.json()) as Card[];
    setCards(data);
  };

  const onAddCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck) {
      return;
    }

    setCardError("");
    setCardValidationErrors([]);
    setSavingCard(true);

    try {
      const response = await fetch(`${API_BASE_URL}/decks/${selectedDeck.id}/cards`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: cardName,
          manaValue: cardManaValue,
          type: cardType,
          colors: cardColors,
          quantity: cardQuantity
        })
      });

      if (!response.ok) {
        const errorResponse = await parseApiError(response);
        setCardError(errorResponse.message);
        setCardValidationErrors(errorResponse.errors);
        return;
      }

      setCardName("");
      setCardManaValue(0);
      setCardType("");
      setCardColors("");
      setCardQuantity(1);
      await loadDeckCards(selectedDeck.id);
      await loadDeckStats(selectedDeck.id);
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSavingCard(false);
    }
  };

  const onDeleteCard = async (cardId: number) => {
    if (!selectedDeck) {
      return;
    }

    setCardError("");
    setCardValidationErrors([]);
    try {
      const response = await fetch(`${API_BASE_URL}/decks/${selectedDeck.id}/cards/${cardId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      await loadDeckCards(selectedDeck.id);
      await loadDeckStats(selectedDeck.id);
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const onImportDecklist = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck) {
      return;
    }

    setImportError("");
    setImportValidationErrors([]);
    setImportingDecklist(true);

    try {
      const response = await fetch(`${API_BASE_URL}/decks/${selectedDeck.id}/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ decklistText })
      });

      if (!response.ok) {
        const errorResponse = await parseApiError(response);
        setImportResult(null);
        setImportError(errorResponse.message);
        setImportValidationErrors(errorResponse.errors);
        return;
      }

      const result = (await response.json()) as ImportResult;
      setImportResult(result);
      await loadDeckCards(selectedDeck.id);
      await loadDeckStats(selectedDeck.id);
    } catch (err) {
      setImportResult(null);
      setImportError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setImportingDecklist(false);
    }
  };

  return (
    <main className="container">
      <h1>MTG Deck Manager</h1>

      <section className="panel">
        <h2>Backend Health</h2>
        <button onClick={checkHealth}>Check Backend Health</button>
        {health && <p>Response: {health}</p>}
        {healthError && <p className="error">Error: {healthError}</p>}
      </section>

      <section className="panel">
        <h2>Create Deck</h2>
        <form onSubmit={onCreateDeck} className="form">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Deck name"
            required
          />
          <input
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            placeholder="Format (e.g. Commander)"
            required
          />
          <input
            value={commander}
            onChange={(event) => setCommander(event.target.value)}
            placeholder="Commander"
            required
          />
          <button type="submit" disabled={savingDeck}>
            {savingDeck ? "Saving..." : "Create Deck"}
          </button>
        </form>
        {createDeckError && <p className="error">Error: {createDeckError}</p>}
      </section>

      <section className="panel">
        <h2>Decks</h2>
        {decksError && <p className="error">Error: {decksError}</p>}
        {decks.length === 0 ? (
          <p>No decks yet.</p>
        ) : (
          <ul className="deck-list">
            {decks.map((deck) => (
              <li key={deck.id}>
                <button className="link-button" onClick={() => void onSelectDeck(deck.id)}>
                  {deck.name} ({deck.format})
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Selected Deck</h2>
        {!selectedDeck ? (
          <p>Select a deck to view details.</p>
        ) : (
          <>
            <div>
              <p><strong>Name:</strong> {selectedDeck.name}</p>
              <p><strong>Format:</strong> {selectedDeck.format}</p>
              <p><strong>Commander:</strong> {selectedDeck.commander}</p>
              <p><strong>Created:</strong> {new Date(selectedDeck.createdAt).toLocaleString()}</p>
            </div>

            <h3>Decklist Import</h3>
            <form onSubmit={onImportDecklist} className="form">
              <textarea
                value={decklistText}
                onChange={(event) => setDecklistText(event.target.value)}
                placeholder={"4 Lightning Bolt\n2 Counterspell\n1 Sol Ring"}
                rows={6}
                required
              />
              <button type="submit" disabled={importingDecklist}>
                {importingDecklist ? "Importing..." : "Import Decklist"}
              </button>
            </form>
            {importError && <p className="error">Error: {importError}</p>}
            {importValidationErrors.length > 0 && (
              <ul className="deck-list error">
                {importValidationErrors.map((error, index) => (
                  <li key={`import-validation-${index}`}>{error}</li>
                ))}
              </ul>
            )}
            {importResult && (
              <div>
                <p><strong>Imported count:</strong> {importResult.importedCount}</p>
                <p><strong>Created cards:</strong></p>
                {importResult.createdCards.length === 0 ? (
                  <p>None</p>
                ) : (
                  <ul className="deck-list">
                    {importResult.createdCards.map((card) => (
                      <li key={card.id}>{card.quantity}x {card.name}</li>
                    ))}
                  </ul>
                )}
                <p><strong>Errors:</strong></p>
                {importResult.errors.length === 0 ? (
                  <p>None</p>
                ) : (
                  <ul className="deck-list">
                    {importResult.errors.map((error, index) => (
                      <li key={`${error.line}-${index}`}>
                        Line {error.line}: {error.message} ({error.rawLine || "empty"})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <h3>Deck Stats</h3>
            {statsError && <p className="error">Error: {statsError}</p>}
            {!stats ? (
              <p>No stats available.</p>
            ) : (
              <>
                <p><strong>Total cards:</strong> {stats.totalCards}</p>
                <p><strong>By color:</strong> {Object.entries(stats.byColor).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"}</p>
                <p><strong>By type:</strong> {Object.entries(stats.byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"}</p>
                <p><strong>Mana curve:</strong> {Object.entries(stats.manaCurve).map(([k, v]) => `MV ${k}: ${v}`).join(", ") || "-"}</p>
              </>
            )}

            <h3>Cards</h3>
            <form onSubmit={onApplyCardFilters} className="form">
              <input
                value={cardSearch}
                onChange={(event) => setCardSearch(event.target.value)}
                placeholder="Search by card name"
              />
              <input
                value={cardTypeFilter}
                onChange={(event) => setCardTypeFilter(event.target.value)}
                placeholder="Filter by type (exact)"
              />
              <input
                value={cardColorFilter}
                onChange={(event) => setCardColorFilter(event.target.value)}
                placeholder="Filter by color (exact, e.g. R)"
              />
              <select value={cardSort} onChange={(event) => setCardSort(event.target.value)}>
                <option value="name:asc">Sort: Name (A-Z)</option>
                <option value="name:desc">Sort: Name (Z-A)</option>
                <option value="manaValue:asc">Sort: Mana Value (Low-High)</option>
                <option value="manaValue:desc">Sort: Mana Value (High-Low)</option>
              </select>
              <div>
                <button type="submit">Apply Filters</button>
                <button type="button" className="small-button" onClick={() => void onResetCardFilters()}>
                  Reset
                </button>
              </div>
            </form>

            <form onSubmit={onAddCard} className="form">
              <input
                value={cardName}
                onChange={(event) => setCardName(event.target.value)}
                placeholder="Card name"
                required
              />
              <input
                type="number"
                value={cardManaValue}
                onChange={(event) => setCardManaValue(Number(event.target.value))}
                min={0}
                required
              />
              <input
                value={cardType}
                onChange={(event) => setCardType(event.target.value)}
                placeholder="Type (e.g. Creature)"
                required
              />
              <input
                value={cardColors}
                onChange={(event) => setCardColors(event.target.value)}
                placeholder="Colors (e.g. W,U)"
                required
              />
              <input
                type="number"
                value={cardQuantity}
                onChange={(event) => setCardQuantity(Number(event.target.value))}
                min={1}
                required
              />
              <button type="submit" disabled={savingCard}>
                {savingCard ? "Adding..." : "Add Card"}
              </button>
            </form>

            {cardError && <p className="error">Error: {cardError}</p>}
            {cardValidationErrors.length > 0 && (
              <ul className="deck-list error">
                {cardValidationErrors.map((error, index) => (
                  <li key={`card-validation-${index}`}>{error}</li>
                ))}
              </ul>
            )}
            {cardsError && <p className="error">Error: {cardsError}</p>}

            {cards.length === 0 ? (
              <p>No cards found.</p>
            ) : (
              <ul className="deck-list">
                {cards.map((card) => (
                  <li key={card.id}>
                    {card.quantity}x {card.name} (MV {card.manaValue}, {card.type}, {card.colors})
                    <button className="small-button" onClick={() => void onDeleteCard(card.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default App;
