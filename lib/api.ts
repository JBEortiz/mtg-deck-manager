import { buildSpringCardQuery } from "@/lib/deck-browsing";
import {
  ApiErrorResponse,
  BuyOpportunities,
  BuyOpportunityFilters,
  BuyOpportunitySort,
  Card,
  CardDetail,
  CardFilters,
  CardLookupResult,
  CardPriceLookupResult,
  CollectorOverview,
  CollectorOverviewFilters,
  CollectorOverviewSort,
  Deck,
  DeckPassport,
  DeckStats,
  DeckWishlist,
  DeckWishlistHistory,
  DeckWishlistPurchase,
  DeckWishlistRefreshResult,
  DeckWishlistSort,
  ImportResult,
  MulliganSample,
  RulesHelperResult,
  User,
  UserPricingPreferences
} from "@/lib/types";

const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const normalizedApiBaseUrl = rawApiBaseUrl && rawApiBaseUrl.length > 0 ? rawApiBaseUrl : "/api";

function assertValidApiBaseUrl(value: string) {
  const isRelativeApiPath = value.startsWith("/");
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(value);

  if (isRelativeApiPath || isAbsoluteHttpUrl) {
    return;
  }

  throw new Error("Invalid NEXT_PUBLIC_API_BASE_URL. Use '/api' or an absolute URL starting with http(s)://");
}

assertValidApiBaseUrl(normalizedApiBaseUrl);

export const API_BASE_URL = normalizedApiBaseUrl.replace(/\/$/, "");

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

export async function deleteDeck(deckId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response);
  }
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

export async function fetchDeckWishlist(deckId: number, sort: DeckWishlistSort = "best-opportunity"): Promise<DeckWishlist> {
  const params = new URLSearchParams({ sort });
  return fetchJson<DeckWishlist>(`/decks/${deckId}/wishlist?${params.toString()}`);
}

export async function addDeckWishlistItem(
  deckId: number,
  payload: { cardName?: string; name?: string; scryfallId?: string | null; targetQuantity?: number }
): Promise<DeckWishlist["items"][number]> {
  return sendJson<DeckWishlist["items"][number]>(`/decks/${deckId}/wishlist`, "POST", payload);
}

export async function deleteDeckWishlistItem(deckId: number, itemId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/wishlist/${itemId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function fetchDeckWishlistHistory(deckId: number, itemId: number): Promise<DeckWishlistHistory> {
  return fetchJson<DeckWishlistHistory>(`/decks/${deckId}/wishlist/${itemId}/history`);
}

export async function refreshDeckWishlistPricing(deckId: number): Promise<DeckWishlistRefreshResult> {
  return sendJson<DeckWishlistRefreshResult>(`/decks/${deckId}/wishlist/refresh`, "POST", {});
}

export async function fetchBuyOpportunities(params: {
  sort?: BuyOpportunitySort;
  signal?: BuyOpportunityFilters["signal"];
  deckId?: BuyOpportunityFilters["deckId"];
  historyStatus?: BuyOpportunityFilters["historyStatus"];
} = {}): Promise<BuyOpportunities> {
  const search = new URLSearchParams();
  if (params.sort) {
    search.set("sort", params.sort);
  }
  if (params.signal && params.signal !== "all") {
    search.set("signal", params.signal);
  }
  if (params.deckId && params.deckId !== "all") {
    search.set("deckId", String(params.deckId));
  }
  if (params.historyStatus && params.historyStatus !== "all") {
    search.set("historyStatus", params.historyStatus);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return fetchJson<BuyOpportunities>(`/buy-opportunities${suffix}`);
}

export async function fetchCollectorOverview(params: {
  sort?: CollectorOverviewSort;
  deckId?: CollectorOverviewFilters["deckId"];
  profitability?: CollectorOverviewFilters["profitability"];
  priceData?: CollectorOverviewFilters["priceData"];
} = {}): Promise<CollectorOverview> {
  const search = new URLSearchParams();
  if (params.sort) {
    search.set("sort", params.sort);
  }
  if (params.deckId && params.deckId !== "all") {
    search.set("deckId", String(params.deckId));
  }
  if (params.profitability && params.profitability !== "all") {
    search.set("profitability", params.profitability);
  }
  if (params.priceData && params.priceData !== "all") {
    search.set("priceData", params.priceData);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return fetchJson<CollectorOverview>(`/collector-overview${suffix}`);
}

export async function createDeckPurchase(
  deckId: number,
  payload: { wishlistItemId?: number; cardName?: string; scryfallId?: string | null; quantity: number; unitPriceUsd: number; purchasedAt?: string }
): Promise<DeckWishlistPurchase> {
  return sendJson<DeckWishlistPurchase>(`/decks/${deckId}/purchases`, "POST", payload);
}

export async function deleteDeckPurchase(deckId: number, purchaseId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/decks/${deckId}/purchases/${purchaseId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response);
  }
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

export type AssistantPriceHistoryPoint = {
  capturedAt: string;
  priceUsd: number;
};

export type AssistantPriceHistoryResult = {
  query: string;
  card: CardPriceLookupResult;
  currentPriceUsd: number | null;
  history: AssistantPriceHistoryPoint[];
  referencePriceUsd: number | null;
  deltaFromReferenceUsd: number | null;
  deltaFromReferencePercent: number | null;
  historyStatus: "none" | "limited" | "available";
  note: string;
};

export async function fetchScryfallPriceHistory(name: string): Promise<AssistantPriceHistoryResult> {
  const params = new URLSearchParams({ name });
  return fetchJson<AssistantPriceHistoryResult>(`/scryfall/price-history?${params.toString()}`);
}

export async function fetchRulesHelperQuery(query: string): Promise<RulesHelperResult> {
  return sendJson<RulesHelperResult>("/rules-helper/query", "POST", { query });
}

export async function fetchCardDetail(identity: string): Promise<CardDetail> {
  return fetchJson<CardDetail>(`/cards/${encodeURIComponent(identity)}`);
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

export async function fetchUserPricingPreferences(): Promise<UserPricingPreferences> {
  const result = await fetchJson<{ preferences: UserPricingPreferences }>("/user/preferences");
  return result.preferences;
}

export async function updateUserPricingPreferences(payload: UserPricingPreferences): Promise<UserPricingPreferences> {
  const result = await sendJson<{ preferences: UserPricingPreferences }>("/user/preferences", "PUT", payload);
  return result.preferences;
}
