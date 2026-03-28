import { FormEvent } from "react";
import { Deck } from "../types/models";

type DeckSidebarProps = {
  name: string;
  format: string;
  commander: string;
  savingDeck: boolean;
  createDeckError: string;
  loadingDecks: boolean;
  decks: Deck[];
  decksError: string;
  selectedDeckId: number | null;
  onNameChange: (value: string) => void;
  onFormatChange: (value: string) => void;
  onCommanderChange: (value: string) => void;
  onCreateDeck: (event: FormEvent) => void;
  onSelectDeck: (deckId: number) => void;
};

function DeckSidebar(props: DeckSidebarProps) {
  const {
    name,
    format,
    commander,
    savingDeck,
    createDeckError,
    loadingDecks,
    decks,
    decksError,
    selectedDeckId,
    onNameChange,
    onFormatChange,
    onCommanderChange,
    onCreateDeck,
    onSelectDeck
  } = props;

  return (
    <aside className="panel sidebar">
      <h2>Decks</h2>

      <details className="mobile-section mobile-section-create" open>
        <summary>
          <h3>Create Deck</h3>
        </summary>
        <div className="mobile-section-content">
          <form onSubmit={onCreateDeck} className="form compact">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Deck name" required />
            </label>
            <label className="field">
              <span>Format</span>
              <input value={format} onChange={(event) => onFormatChange(event.target.value)} placeholder="Commander" required />
            </label>
            <label className="field">
              <span>Commander</span>
              <input value={commander} onChange={(event) => onCommanderChange(event.target.value)} placeholder="Mizzix" />
            </label>
            <button className="btn" type="submit" disabled={savingDeck}>{savingDeck ? "Creating..." : "Create Deck"}</button>
          </form>
        </div>
      </details>
      {createDeckError && <p className="error">{createDeckError}</p>}

      {loadingDecks ? (
        <p className="muted">Loading decks...</p>
      ) : decks.length === 0 ? (
        <p className="muted">No decks yet. Create your first deck.</p>
      ) : (
        <ul className="deck-menu">
          {decks.map((deck) => (
            <li key={deck.id}>
              <button
                className={`deck-menu-item${selectedDeckId === deck.id ? " active" : ""}`}
                onClick={() => onSelectDeck(deck.id)}
              >
                <div className="deck-cover-wrap">
                  {deck.deckCoverUrl ? (
                    <img className="deck-cover-image" src={deck.deckCoverUrl} alt={`${deck.name} cover`} loading="lazy" />
                  ) : (
                    <div className="deck-cover-placeholder">No Image</div>
                  )}
                </div>
                <strong>{deck.name}</strong>
                <span className="deck-menu-meta">{deck.format} | {deck.commander || "No commander"}</span>
                <span className="deck-menu-count">Cards: {deck.totalCardCount ?? 0}</span>
                {deck.cardPreview && deck.cardPreview.length > 0 ? (
                  <span className="deck-menu-preview">{deck.cardPreview.join(" • ")}</span>
                ) : (
                  <span className="deck-menu-preview muted">No cards yet.</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {decksError && <p className="error">{decksError}</p>}
    </aside>
  );
}

export default DeckSidebar;
