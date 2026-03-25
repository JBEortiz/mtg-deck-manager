import { ApiErrorResponse, Card, CardFilters, Deck, DeckStats, ImportResult } from "../types/models";

const API_BASE_URL = "http://localhost:8080/api";

export class ApiClientError extends Error {
  errors: string[];

  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "ApiClientError";
    this.errors = errors;
  }
}

async function parseError(response: Response): Promise<ApiClientError> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const data = (await response.json()) as ApiErrorResponse;
    return new ApiClientError(data.message ?? fallback, Array.isArray(data.errors) ? data.errors : []);
  } catch {
    return new ApiClientError(fallback, []);
  }
}

function buildCardsUrl(deckId: number, filters: CardFilters): string {
  const params = new URLSearchParams();

  if (filters.name.trim()) {
    params.set("name", filters.name.trim());
  }
  if (filters.type.trim()) {
    params.set("type", filters.type.trim());
  }
  if (filters.color.trim()) {
    params.set("color", filters.color.trim());
  }

  const [sortBy, direction] = filters.sort.split(":");
  if (sortBy) {
    params.set("sortBy", sortBy);
  }
  if (direction) {
    params.set("direction", direction);
  }

  const query = params.toString();
  return `${API_BASE_URL}/decks/${deckId}/cards${query ? `?${query}` : ""}`;
}

export async function fetchHealth(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.text();
}

export async function fetchDecks(): Promise<Deck[]> {
  const response = await fetch(`${API_BASE_URL}/decks`);
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function fetchDeck(deckId: number): Promise<Deck> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}`);
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function createDeck(payload: { name: string; format: string; commander: string }): Promise<Deck> {
  const response = await fetch(`${API_BASE_URL}/decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function updateDeck(deckId: number, payload: { name: string; format: string; commander: string }): Promise<Deck> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function fetchDeckStats(deckId: number): Promise<DeckStats> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/stats`);
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function fetchDeckCards(deckId: number, filters: CardFilters): Promise<Card[]> {
  const response = await fetch(buildCardsUrl(deckId, filters));
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function createCard(deckId: number, payload: { name: string; manaValue: number; type: string; colors: string; quantity: number }): Promise<Card> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function updateCard(deckId: number, cardId: number, payload: { name: string; manaValue: number; type: string; colors: string; quantity: number }): Promise<Card> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/cards/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

export async function deleteCard(deckId: number, cardId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/cards/${cardId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function importDecklist(deckId: number, decklistText: string): Promise<ImportResult> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decklistText })
  });

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}
