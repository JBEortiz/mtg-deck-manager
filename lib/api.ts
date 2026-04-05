import { buildSpringCardQuery } from "@/lib/deck-browsing";
import { ApiErrorResponse, Card, CardFilters, CardLookupResult, Deck, DeckPassport, DeckStats, ImportResult, MulliganSample, User } from "@/lib/types";

const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
export const API_BASE_URL = (rawApiBaseUrl && rawApiBaseUrl.length > 0 ? rawApiBaseUrl : "/api").replace(/\/$/, "");

export class ApiClientError extends Error {
  status: number;
  errors: string[];

  constructor(message: string, status: number, errors: string[] = []) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.errors = errors;
  }
}

async function parseError(response: Response): Promise<ApiClientError> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const data = (await response.json()) as ApiErrorResponse;
    return new ApiClientError(data.message ?? fallback, response.status, Array.isArray(data.errors) ? data.errors : []);
  } catch {
    return new ApiClientError(fallback, response.status, []);
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function sendJson<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<T>;
}

export async function fetchDecks(): Promise<Deck[]> {
  return fetchJson<Deck[]>("/decks");
}

export async function fetchDeck(deckId: number): Promise<Deck> {
  return fetchJson<Deck>(`/decks/${deckId}`);
}

export async function createDeck(payload: { name: string; format: string; commander: string }): Promise<Deck> {
  return sendJson<Deck>("/decks", "POST", payload);
}

export async function fetchDeckCards(deckId: number, filters: Partial<CardFilters> = {}): Promise<Card[]> {
  const params = buildSpringCardQuery(filters);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<Card[]>(`/decks/${deckId}/cards${suffix}`);
}

export async function createCard(
  deckId: number,
  payload: { name: string; manaValue: number; type: string; colors: string; quantity: number; scryfallId?: string | null; imageSmall?: string | null; imageNormal?: string | null; imageUrl?: string | null }
): Promise<Card> {
  return sendJson<Card>(`/decks/${deckId}/cards`, "POST", payload);
}

export async function updateCard(
  deckId: number,
  cardId: number,
  payload: { name: string; manaValue: number; type: string; colors: string; quantity: number; scryfallId?: string | null; imageSmall?: string | null; imageNormal?: string | null; imageUrl?: string | null }
): Promise<Card> {
  return sendJson<Card>(`/decks/${deckId}/cards/${cardId}`, "PUT", payload);
}

export async function deleteCard(deckId: number, cardId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/cards/${cardId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function fetchDeckStats(deckId: number): Promise<DeckStats> {
  return fetchJson<DeckStats>(`/decks/${deckId}/stats`);
}

export async function fetchDeckPassport(deckId: number): Promise<DeckPassport> {
  return fetchJson<DeckPassport>(`/decks/${deckId}/passport`);
}

export async function fetchMulliganSample(deckId: number): Promise<MulliganSample> {
  return fetchJson<MulliganSample>(`/decks/${deckId}/mulligan-sample`);
}

export async function importDecklist(deckId: number, decklistText: string): Promise<ImportResult> {
  return sendJson<ImportResult>(`/decks/${deckId}/import`, "POST", { decklistText });
}

export async function fetchDecklistExport(deckId: number): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/export`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.text();
}

export async function fetchScryfallSearch(query: string, limit = 8): Promise<CardLookupResult[]> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return fetchJson<CardLookupResult[]>(`/scryfall/search?${params.toString()}`);
}

export async function fetchScryfallAutocomplete(query: string): Promise<string[]> {
  const params = new URLSearchParams({ query });
  return fetchJson<string[]>(`/scryfall/autocomplete?${params.toString()}`);
}

export async function fetchScryfallCardByName(name: string): Promise<CardLookupResult> {
  const params = new URLSearchParams({ name });
  return fetchJson<CardLookupResult>(`/scryfall/card?${params.toString()}`);
}

export async function fetchHealth(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.text();
}

export async function registerUser(payload: { confirmPassword: string; email: string; password: string }): Promise<{ user: User }> {
  return sendJson<{ user: User }>("/auth/register", "POST", payload);
}

export async function loginUser(payload: { email: string; password: string }): Promise<{ user: User }> {
  return sendJson<{ user: User }>("/auth/login", "POST", payload);
}

export async function logoutUser(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function fetchCurrentSession(): Promise<{ user: User | null }> {
  return fetchJson<{ user: User | null }>("/auth/session");
}
