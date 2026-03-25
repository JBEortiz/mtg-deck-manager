import { FormEvent, useEffect, useRef, useState } from "react";
import AppHeader from "./components/AppHeader";
import DeckSidebar from "./components/DeckSidebar";
import DeckDetails from "./components/DeckDetails";
import {
  ApiClientError,
  createCard,
  createDeck,
  deleteCard,
  fetchDeck,
  fetchDeckCards,
  fetchDeckStats,
  fetchDecks,
  fetchHealth,
  fetchScryfallAutocomplete,
  fetchScryfallCardByName,
  importDecklist,
  updateCard,
  updateDeck
} from "./services/api";
import { Card, CardFilters, CardLookupResult, Deck, DeckStats, ImportResult } from "./types/models";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function getValidationErrors(error: unknown): string[] {
  return error instanceof ApiClientError ? error.errors : [];
}

function App() {
  const [health, setHealth] = useState("");
  const [healthError, setHealthError] = useState("");
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksError, setDecksError] = useState("");
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);

  const [cards, setCards] = useState<Card[]>([]);
  const [cardsError, setCardsError] = useState("");
  const [loadingCards, setLoadingCards] = useState(false);

  const [stats, setStats] = useState<DeckStats | null>(null);
  const [statsError, setStatsError] = useState("");
  const [loadingStats, setLoadingStats] = useState(false);

  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [format, setFormat] = useState("");
  const [commander, setCommander] = useState("");
  const [createDeckError, setCreateDeckError] = useState("");
  const [savingDeck, setSavingDeck] = useState(false);

  const [editingDeckName, setEditingDeckName] = useState("");
  const [editingDeckFormat, setEditingDeckFormat] = useState("");
  const [editingDeckCommander, setEditingDeckCommander] = useState("");
  const [updateDeckError, setUpdateDeckError] = useState("");
  const [updateDeckValidationErrors, setUpdateDeckValidationErrors] = useState<string[]>([]);
  const [updatingDeck, setUpdatingDeck] = useState(false);

  const [cardLookupQuery, setCardLookupQuery] = useState("");
  const [cardSuggestions, setCardSuggestions] = useState<string[]>([]);
  const [cardLookupLoading, setCardLookupLoading] = useState(false);
  const [cardLookupError, setCardLookupError] = useState("");
  const autocompleteCacheRef = useRef<Map<string, string[]>>(new Map());
  const cardDetailsCacheRef = useRef<Map<string, CardLookupResult>>(new Map());

  const [cardName, setCardName] = useState("");
  const [cardManaValue, setCardManaValue] = useState(0);
  const [cardType, setCardType] = useState("");
  const [cardColors, setCardColors] = useState("");
  const [cardQuantity, setCardQuantity] = useState(1);
  const [cardError, setCardError] = useState("");
  const [cardValidationErrors, setCardValidationErrors] = useState<string[]>([]);
  const [savingCard, setSavingCard] = useState(false);

  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [editingCardName, setEditingCardName] = useState("");
  const [editingCardManaValue, setEditingCardManaValue] = useState(0);
  const [editingCardType, setEditingCardType] = useState("");
  const [editingCardColors, setEditingCardColors] = useState("");
  const [editingCardQuantity, setEditingCardQuantity] = useState(1);
  const [updatingCard, setUpdatingCard] = useState(false);

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
    setLoadingDecks(true);
    setDecksError("");

    try {
      setDecks(await fetchDecks());
    } catch (error) {
      setDecks([]);
      setDecksError(getErrorMessage(error));
    } finally {
      setLoadingDecks(false);
    }
  };

  const loadDeckCards = async (deckId: number, overrides?: Partial<CardFilters>) => {
    setLoadingCards(true);
    setCardsError("");

    const filters: CardFilters = {
      name: overrides?.name ?? cardSearch,
      type: overrides?.type ?? cardTypeFilter,
      color: overrides?.color ?? cardColorFilter,
      sort: overrides?.sort ?? cardSort
    };

    try {
      setCards(await fetchDeckCards(deckId, filters));
    } catch (error) {
      setCards([]);
      setCardsError(getErrorMessage(error));
    } finally {
      setLoadingCards(false);
    }
  };

  const loadDeckStats = async (deckId: number) => {
    setLoadingStats(true);
    setStatsError("");

    try {
      setStats(await fetchDeckStats(deckId));
    } catch (error) {
      setStats(null);
      setStatsError(getErrorMessage(error));
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    void loadDecks();
  }, []);

  useEffect(() => {
    const query = cardLookupQuery.trim();
    if (query.length < 2) {
      setCardSuggestions([]);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setCardLookupError("");

      const cached = autocompleteCacheRef.current.get(query.toLowerCase());
      if (cached) {
        setCardSuggestions(cached);
        return;
      }

      setCardLookupLoading(true);
      try {
        const results = await fetchScryfallAutocomplete(query);
        autocompleteCacheRef.current.set(query.toLowerCase(), results);
        setCardSuggestions(results);
      } catch (error) {
        setCardSuggestions([]);
        setCardLookupError(getErrorMessage(error));
      } finally {
        setCardLookupLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [cardLookupQuery]);

  const checkHealth = async () => {
    setHealth("");
    setHealthError("");
    setCheckingHealth(true);

    try {
      setHealth(await fetchHealth());
    } catch (error) {
      setHealthError(getErrorMessage(error));
    } finally {
      setCheckingHealth(false);
    }
  };

  const onCreateDeck = async (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    setCreateDeckError("");
    setSavingDeck(true);

    try {
      const createdDeck = await createDeck({ name, format, commander });
      setName("");
      setFormat("");
      setCommander("");
      await loadDecks();
      setSelectedDeck(createdDeck);
      setEditingDeckName(createdDeck.name);
      setEditingDeckFormat(createdDeck.format);
      setEditingDeckCommander(createdDeck.commander);
      setCards([]);
      setStats(null);
      setImportResult(null);
      await Promise.all([loadDeckCards(createdDeck.id), loadDeckStats(createdDeck.id)]);
      setNotice("Deck created.");
    } catch (error) {
      setCreateDeckError(getErrorMessage(error));
    } finally {
      setSavingDeck(false);
    }
  };

  const onSelectDeck = async (id: number) => {
    setNotice("");

    try {
      const deck = await fetchDeck(id);
      setSelectedDeck(deck);
      setEditingDeckName(deck.name);
      setEditingDeckFormat(deck.format);
      setEditingDeckCommander(deck.commander);
      setUpdateDeckError("");
      setUpdateDeckValidationErrors([]);
      setImportResult(null);
      setImportValidationErrors([]);
      setEditingCardId(null);
      await Promise.all([loadDeckCards(deck.id), loadDeckStats(deck.id)]);
    } catch (error) {
      setCreateDeckError(getErrorMessage(error));
    }
  };

  const onUpdateDeck = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck) {
      return;
    }

    setNotice("");
    setUpdateDeckError("");
    setUpdateDeckValidationErrors([]);
    setUpdatingDeck(true);

    try {
      const updated = await updateDeck(selectedDeck.id, {
        name: editingDeckName,
        format: editingDeckFormat,
        commander: editingDeckCommander
      });

      setSelectedDeck(updated);
      await Promise.all([loadDecks(), loadDeckStats(updated.id)]);
      setNotice("Deck updated.");
    } catch (error) {
      setUpdateDeckError(getErrorMessage(error));
      setUpdateDeckValidationErrors(getValidationErrors(error));
    } finally {
      setUpdatingDeck(false);
    }
  };

  const onSelectSuggestion = async (name: string) => {
    setCardLookupError("");
    setCardLookupQuery(name);
    setCardSuggestions([]);

    const cached = cardDetailsCacheRef.current.get(name.toLowerCase());
    if (cached) {
      setCardName(cached.name);
      setCardManaValue(cached.manaValue);
      setCardType(cached.type);
      setCardColors(cached.colors);
      setNotice(`Loaded ${cached.name} into the form.`);
      return;
    }

    setCardLookupLoading(true);
    try {
      const card = await fetchScryfallCardByName(name);
      cardDetailsCacheRef.current.set(name.toLowerCase(), card);
      setCardName(card.name);
      setCardManaValue(card.manaValue);
      setCardType(card.type);
      setCardColors(card.colors);
      setNotice(`Loaded ${card.name} into the form.`);
    } catch (error) {
      setCardLookupError(getErrorMessage(error));
    } finally {
      setCardLookupLoading(false);
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

    await loadDeckCards(selectedDeck.id, {
      name: "",
      type: "",
      color: "",
      sort: "name:asc"
    });
  };

  const onAddCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck) {
      return;
    }

    setNotice("");
    setCardError("");
    setCardValidationErrors([]);
    setSavingCard(true);

    try {
      await createCard(selectedDeck.id, {
        name: cardName,
        manaValue: cardManaValue,
        type: cardType,
        colors: cardColors,
        quantity: cardQuantity
      });

      setCardName("");
      setCardManaValue(0);
      setCardType("");
      setCardColors("");
      setCardQuantity(1);
      setCardLookupQuery("");
      setCardSuggestions([]);
      await Promise.all([loadDeckCards(selectedDeck.id), loadDeckStats(selectedDeck.id)]);
      setNotice("Card added.");
    } catch (error) {
      setCardError(getErrorMessage(error));
      setCardValidationErrors(getValidationErrors(error));
    } finally {
      setSavingCard(false);
    }
  };

  const startEditingCard = (card: Card) => {
    setEditingCardId(card.id);
    setEditingCardName(card.name);
    setEditingCardManaValue(card.manaValue);
    setEditingCardType(card.type);
    setEditingCardColors(card.colors);
    setEditingCardQuantity(card.quantity);
    setCardError("");
    setCardValidationErrors([]);
  };

  const cancelEditingCard = () => {
    setEditingCardId(null);
    setEditingCardName("");
    setEditingCardManaValue(0);
    setEditingCardType("");
    setEditingCardColors("");
    setEditingCardQuantity(1);
  };

  const onUpdateCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck || editingCardId === null) {
      return;
    }

    setNotice("");
    setCardError("");
    setCardValidationErrors([]);
    setUpdatingCard(true);

    try {
      await updateCard(selectedDeck.id, editingCardId, {
        name: editingCardName,
        manaValue: editingCardManaValue,
        type: editingCardType,
        colors: editingCardColors,
        quantity: editingCardQuantity
      });

      cancelEditingCard();
      await Promise.all([loadDeckCards(selectedDeck.id), loadDeckStats(selectedDeck.id)]);
      setNotice("Card updated.");
    } catch (error) {
      setCardError(getErrorMessage(error));
      setCardValidationErrors(getValidationErrors(error));
    } finally {
      setUpdatingCard(false);
    }
  };

  const onDeleteCard = async (cardId: number, cardDisplayName: string) => {
    if (!selectedDeck) {
      return;
    }

    const confirmed = window.confirm(`Remove ${cardDisplayName} from this deck?`);
    if (!confirmed) {
      return;
    }

    setNotice("");
    setCardError("");
    setCardValidationErrors([]);

    try {
      await deleteCard(selectedDeck.id, cardId);
      await Promise.all([loadDeckCards(selectedDeck.id), loadDeckStats(selectedDeck.id)]);
      setNotice("Card removed.");
    } catch (error) {
      setCardError(getErrorMessage(error));
    }
  };

  const onImportDecklist = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeck) {
      return;
    }

    setNotice("");
    setImportError("");
    setImportValidationErrors([]);
    setImportingDecklist(true);

    try {
      const result = await importDecklist(selectedDeck.id, decklistText);
      setImportResult(result);
      await Promise.all([loadDeckCards(selectedDeck.id), loadDeckStats(selectedDeck.id)]);
      setNotice("Decklist imported.");
    } catch (error) {
      setImportResult(null);
      setImportError(getErrorMessage(error));
      setImportValidationErrors(getValidationErrors(error));
    } finally {
      setImportingDecklist(false);
    }
  };

  return (
    <main className="app">
      <AppHeader
        checkingHealth={checkingHealth}
        health={health}
        healthError={healthError}
        onCheckHealth={() => void checkHealth()}
      />

      {notice && <div className="notice success">{notice}</div>}

      <div className="layout">
        <DeckSidebar
          name={name}
          format={format}
          commander={commander}
          savingDeck={savingDeck}
          createDeckError={createDeckError}
          loadingDecks={loadingDecks}
          decks={decks}
          decksError={decksError}
          selectedDeckId={selectedDeck?.id ?? null}
          onNameChange={setName}
          onFormatChange={setFormat}
          onCommanderChange={setCommander}
          onCreateDeck={(event) => void onCreateDeck(event)}
          onSelectDeck={(deckId) => void onSelectDeck(deckId)}
        />

        <DeckDetails
          selectedDeck={selectedDeck}
          editingDeckName={editingDeckName}
          editingDeckFormat={editingDeckFormat}
          editingDeckCommander={editingDeckCommander}
          updatingDeck={updatingDeck}
          updateDeckError={updateDeckError}
          updateDeckValidationErrors={updateDeckValidationErrors}
          onEditingDeckNameChange={setEditingDeckName}
          onEditingDeckFormatChange={setEditingDeckFormat}
          onEditingDeckCommanderChange={setEditingDeckCommander}
          onUpdateDeck={(event) => void onUpdateDeck(event)}
          loadingStats={loadingStats}
          statsError={statsError}
          stats={stats}
          decklistText={decklistText}
          importingDecklist={importingDecklist}
          importError={importError}
          importValidationErrors={importValidationErrors}
          importResult={importResult}
          onDecklistTextChange={setDecklistText}
          onImportDecklist={(event) => void onImportDecklist(event)}
          cardSearch={cardSearch}
          cardTypeFilter={cardTypeFilter}
          cardColorFilter={cardColorFilter}
          cardSort={cardSort}
          onCardSearchChange={setCardSearch}
          onCardTypeFilterChange={setCardTypeFilter}
          onCardColorFilterChange={setCardColorFilter}
          onCardSortChange={setCardSort}
          onApplyCardFilters={(event) => void onApplyCardFilters(event)}
          onResetCardFilters={() => void onResetCardFilters()}
          cardLookupQuery={cardLookupQuery}
          cardSuggestions={cardSuggestions}
          cardLookupLoading={cardLookupLoading}
          cardLookupError={cardLookupError}
          onCardLookupQueryChange={setCardLookupQuery}
          onSelectSuggestion={(name) => void onSelectSuggestion(name)}
          cardName={cardName}
          cardManaValue={cardManaValue}
          cardType={cardType}
          cardColors={cardColors}
          cardQuantity={cardQuantity}
          savingCard={savingCard}
          cardError={cardError}
          cardValidationErrors={cardValidationErrors}
          onCardNameChange={setCardName}
          onCardManaValueChange={setCardManaValue}
          onCardTypeChange={setCardType}
          onCardColorsChange={setCardColors}
          onCardQuantityChange={setCardQuantity}
          onAddCard={(event) => void onAddCard(event)}
          editingCardId={editingCardId}
          editingCardName={editingCardName}
          editingCardManaValue={editingCardManaValue}
          editingCardType={editingCardType}
          editingCardColors={editingCardColors}
          editingCardQuantity={editingCardQuantity}
          updatingCard={updatingCard}
          onEditingCardNameChange={setEditingCardName}
          onEditingCardManaValueChange={setEditingCardManaValue}
          onEditingCardTypeChange={setEditingCardType}
          onEditingCardColorsChange={setEditingCardColors}
          onEditingCardQuantityChange={setEditingCardQuantity}
          onUpdateCard={(event) => void onUpdateCard(event)}
          onCancelEditingCard={cancelEditingCard}
          cardsError={cardsError}
          loadingCards={loadingCards}
          cards={cards}
          onStartEditingCard={startEditingCard}
          onDeleteCard={(cardId, cardDisplayName) => void onDeleteCard(cardId, cardDisplayName)}
        />
      </div>
    </main>
  );
}

export default App;
