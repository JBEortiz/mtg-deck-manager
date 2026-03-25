import { FormEvent } from "react";
import ErrorList from "./ErrorList";
import { Card, Deck, DeckStats, ImportResult } from "../types/models";

type DeckDetailsProps = {
  selectedDeck: Deck | null;
  editingDeckName: string;
  editingDeckFormat: string;
  editingDeckCommander: string;
  updatingDeck: boolean;
  updateDeckError: string;
  updateDeckValidationErrors: string[];
  onEditingDeckNameChange: (value: string) => void;
  onEditingDeckFormatChange: (value: string) => void;
  onEditingDeckCommanderChange: (value: string) => void;
  onUpdateDeck: (event: FormEvent) => void;
  loadingStats: boolean;
  statsError: string;
  stats: DeckStats | null;
  decklistText: string;
  importingDecklist: boolean;
  importError: string;
  importValidationErrors: string[];
  importResult: ImportResult | null;
  onDecklistTextChange: (value: string) => void;
  onImportDecklist: (event: FormEvent) => void;
  cardSearch: string;
  cardTypeFilter: string;
  cardColorFilter: string;
  cardSort: string;
  onCardSearchChange: (value: string) => void;
  onCardTypeFilterChange: (value: string) => void;
  onCardColorFilterChange: (value: string) => void;
  onCardSortChange: (value: string) => void;
  onApplyCardFilters: (event: FormEvent) => void;
  onResetCardFilters: () => void;
  cardName: string;
  cardManaValue: number;
  cardType: string;
  cardColors: string;
  cardQuantity: number;
  savingCard: boolean;
  cardError: string;
  cardValidationErrors: string[];
  onCardNameChange: (value: string) => void;
  onCardManaValueChange: (value: number) => void;
  onCardTypeChange: (value: string) => void;
  onCardColorsChange: (value: string) => void;
  onCardQuantityChange: (value: number) => void;
  onAddCard: (event: FormEvent) => void;
  editingCardId: number | null;
  editingCardName: string;
  editingCardManaValue: number;
  editingCardType: string;
  editingCardColors: string;
  editingCardQuantity: number;
  updatingCard: boolean;
  onEditingCardNameChange: (value: string) => void;
  onEditingCardManaValueChange: (value: number) => void;
  onEditingCardTypeChange: (value: string) => void;
  onEditingCardColorsChange: (value: string) => void;
  onEditingCardQuantityChange: (value: number) => void;
  onUpdateCard: (event: FormEvent) => void;
  onCancelEditingCard: () => void;
  cardsError: string;
  loadingCards: boolean;
  cards: Card[];
  onStartEditingCard: (card: Card) => void;
  onDeleteCard: (cardId: number, cardName: string) => void;
};

function DeckDetails(props: DeckDetailsProps) {
  const {
    selectedDeck,
    editingDeckName,
    editingDeckFormat,
    editingDeckCommander,
    updatingDeck,
    updateDeckError,
    updateDeckValidationErrors,
    onEditingDeckNameChange,
    onEditingDeckFormatChange,
    onEditingDeckCommanderChange,
    onUpdateDeck,
    loadingStats,
    statsError,
    stats,
    decklistText,
    importingDecklist,
    importError,
    importValidationErrors,
    importResult,
    onDecklistTextChange,
    onImportDecklist,
    cardSearch,
    cardTypeFilter,
    cardColorFilter,
    cardSort,
    onCardSearchChange,
    onCardTypeFilterChange,
    onCardColorFilterChange,
    onCardSortChange,
    onApplyCardFilters,
    onResetCardFilters,
    cardName,
    cardManaValue,
    cardType,
    cardColors,
    cardQuantity,
    savingCard,
    cardError,
    cardValidationErrors,
    onCardNameChange,
    onCardManaValueChange,
    onCardTypeChange,
    onCardColorsChange,
    onCardQuantityChange,
    onAddCard,
    editingCardId,
    editingCardName,
    editingCardManaValue,
    editingCardType,
    editingCardColors,
    editingCardQuantity,
    updatingCard,
    onEditingCardNameChange,
    onEditingCardManaValueChange,
    onEditingCardTypeChange,
    onEditingCardColorsChange,
    onEditingCardQuantityChange,
    onUpdateCard,
    onCancelEditingCard,
    cardsError,
    loadingCards,
    cards,
    onStartEditingCard,
    onDeleteCard
  } = props;

  return (
    <section className="panel content">
      {!selectedDeck ? (
        <div className="empty-state">
          <h2>Select a Deck</h2>
          <p>Pick a deck from the left to view details, cards, stats, and import options.</p>
        </div>
      ) : (
        <>
          <div className="section-header">
            <h2>{selectedDeck.name}</h2>
            <p className="muted">
              {selectedDeck.format} | Commander: {selectedDeck.commander} | Created {new Date(selectedDeck.createdAt).toLocaleString()}
            </p>
          </div>

          <section className="subsection">
            <h3>Edit Deck</h3>
            <form onSubmit={onUpdateDeck} className="form grid-3">
              <label className="field">
                <span>Name</span>
                <input value={editingDeckName} onChange={(event) => onEditingDeckNameChange(event.target.value)} required />
              </label>
              <label className="field">
                <span>Format</span>
                <input value={editingDeckFormat} onChange={(event) => onEditingDeckFormatChange(event.target.value)} required />
              </label>
              <label className="field">
                <span>Commander</span>
                <input value={editingDeckCommander} onChange={(event) => onEditingDeckCommanderChange(event.target.value)} required />
              </label>
              <button className="btn" type="submit" disabled={updatingDeck}>{updatingDeck ? "Saving..." : "Save Deck"}</button>
            </form>
            {updateDeckError && <p className="error">{updateDeckError}</p>}
            <ErrorList errors={updateDeckValidationErrors} />
          </section>

          <section className="subsection">
            <h3>Deck Stats</h3>
            {loadingStats ? (
              <p className="muted">Loading stats...</p>
            ) : statsError ? (
              <p className="error">{statsError}</p>
            ) : !stats ? (
              <p className="muted">No stats available.</p>
            ) : (
              <div className="stats-grid">
                <div className="stat-card"><span>Total Cards</span><strong>{stats.totalCards}</strong></div>
                <div className="stat-card"><span>By Color</span><p>{Object.entries(stats.byColor).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"}</p></div>
                <div className="stat-card"><span>By Type</span><p>{Object.entries(stats.byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"}</p></div>
                <div className="stat-card"><span>Mana Curve</span><p>{Object.entries(stats.manaCurve).map(([k, v]) => `MV ${k}: ${v}`).join(", ") || "-"}</p></div>
              </div>
            )}
          </section>

          <section className="subsection">
            <h3>Import Decklist</h3>
            <form onSubmit={onImportDecklist} className="form">
              <label className="field">
                <span>Paste decklist text</span>
                <textarea
                  value={decklistText}
                  onChange={(event) => onDecklistTextChange(event.target.value)}
                  placeholder={"4 Lightning Bolt\n2 Counterspell\n1 Sol Ring"}
                  rows={6}
                  required
                />
              </label>
              <button className="btn" type="submit" disabled={importingDecklist}>{importingDecklist ? "Importing..." : "Import Decklist"}</button>
            </form>
            {importError && <p className="error">{importError}</p>}
            <ErrorList errors={importValidationErrors} />
            {importResult && (
              <div className="result-box">
                <p><strong>Imported:</strong> {importResult.importedCount} cards</p>
                <p><strong>Created entries:</strong> {importResult.createdCards.length}</p>
                {importResult.createdCards.length > 0 && (
                  <ul className="list">
                    {importResult.createdCards.map((card) => <li key={card.id}>{card.quantity}x {card.name}</li>)}
                  </ul>
                )}
                {importResult.errors.length > 0 && (
                  <>
                    <p><strong>Line issues:</strong></p>
                    <ul className="list">
                      {importResult.errors.map((error, index) => (
                        <li key={`${error.line}-${index}`}>Line {error.line}: {error.message} ({error.rawLine || "empty"})</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="subsection">
            <h3>Cards</h3>
            <form onSubmit={onApplyCardFilters} className="form grid-4">
              <label className="field"><span>Search</span><input value={cardSearch} onChange={(event) => onCardSearchChange(event.target.value)} placeholder="Partial name" /></label>
              <label className="field"><span>Type</span><input value={cardTypeFilter} onChange={(event) => onCardTypeFilterChange(event.target.value)} placeholder="Exact type" /></label>
              <label className="field"><span>Color</span><input value={cardColorFilter} onChange={(event) => onCardColorFilterChange(event.target.value)} placeholder="Exact color" /></label>
              <label className="field">
                <span>Sort</span>
                <select value={cardSort} onChange={(event) => onCardSortChange(event.target.value)}>
                  <option value="name:asc">Name (A-Z)</option>
                  <option value="name:desc">Name (Z-A)</option>
                  <option value="manaValue:asc">Mana Value (Low-High)</option>
                  <option value="manaValue:desc">Mana Value (High-Low)</option>
                </select>
              </label>
              <div className="button-row">
                <button className="btn" type="submit">Apply</button>
                <button className="btn secondary" type="button" onClick={onResetCardFilters}>Reset</button>
              </div>
            </form>

            <form onSubmit={onAddCard} className="form grid-5">
              <label className="field"><span>Name</span><input value={cardName} onChange={(event) => onCardNameChange(event.target.value)} required /></label>
              <label className="field"><span>Mana Value</span><input type="number" value={cardManaValue} onChange={(event) => onCardManaValueChange(Number(event.target.value))} min={0} required /></label>
              <label className="field"><span>Type</span><input value={cardType} onChange={(event) => onCardTypeChange(event.target.value)} required /></label>
              <label className="field"><span>Colors</span><input value={cardColors} onChange={(event) => onCardColorsChange(event.target.value)} required /></label>
              <label className="field"><span>Quantity</span><input type="number" value={cardQuantity} onChange={(event) => onCardQuantityChange(Number(event.target.value))} min={1} required /></label>
              <button className="btn" type="submit" disabled={savingCard}>{savingCard ? "Adding..." : "Add Card"}</button>
            </form>

            {editingCardId !== null && (
              <form onSubmit={onUpdateCard} className="form grid-5 edit-box">
                <h4>Edit Card #{editingCardId}</h4>
                <label className="field"><span>Name</span><input value={editingCardName} onChange={(event) => onEditingCardNameChange(event.target.value)} required /></label>
                <label className="field"><span>Mana Value</span><input type="number" value={editingCardManaValue} onChange={(event) => onEditingCardManaValueChange(Number(event.target.value))} min={0} required /></label>
                <label className="field"><span>Type</span><input value={editingCardType} onChange={(event) => onEditingCardTypeChange(event.target.value)} required /></label>
                <label className="field"><span>Colors</span><input value={editingCardColors} onChange={(event) => onEditingCardColorsChange(event.target.value)} required /></label>
                <label className="field"><span>Quantity</span><input type="number" value={editingCardQuantity} onChange={(event) => onEditingCardQuantityChange(Number(event.target.value))} min={1} required /></label>
                <div className="button-row">
                  <button className="btn" type="submit" disabled={updatingCard}>{updatingCard ? "Saving..." : "Save Card"}</button>
                  <button className="btn secondary" type="button" onClick={onCancelEditingCard}>Cancel</button>
                </div>
              </form>
            )}

            {cardError && <p className="error">{cardError}</p>}
            <ErrorList errors={cardValidationErrors} />
            {cardsError && <p className="error">{cardsError}</p>}

            {loadingCards ? (
              <p className="muted">Loading cards...</p>
            ) : cards.length === 0 ? (
              <p className="muted">No cards found for current filters.</p>
            ) : (
              <ul className="card-list">
                {cards.map((card) => (
                  <li key={card.id} className="card-row">
                    <div>
                      <strong>{card.quantity}x {card.name}</strong>
                      <p className="muted">MV {card.manaValue} | {card.type} | {card.colors}</p>
                    </div>
                    <div className="button-row">
                      <button className="btn secondary" onClick={() => onStartEditingCard(card)}>Edit</button>
                      <button className="btn danger" onClick={() => onDeleteCard(card.id, card.name)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

export default DeckDetails;
