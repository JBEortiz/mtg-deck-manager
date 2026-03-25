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
          <input value={commander} onChange={(event) => onCommanderChange(event.target.value)} placeholder="Mizzix" required />
        </label>
        <button className="btn" type="submit" disabled={savingDeck}>{savingDeck ? "Creating..." : "Create Deck"}</button>
      </form>
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
                <strong>{deck.name}</strong>
                <span>{deck.format}</span>
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
