const API_BASE_URL = "http://localhost:8080/api";
export class ApiClientError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = "ApiClientError";
        this.errors = errors;
    }
}
async function parseError(response) {
    const fallback = `Request failed with status ${response.status}`;
    try {
        const data = (await response.json());
        return new ApiClientError(data.message ?? fallback, Array.isArray(data.errors) ? data.errors : []);
    }
    catch {
        return new ApiClientError(fallback, []);
    }
}
function buildCardsUrl(deckId, filters) {
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
export async function fetchHealth() {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.text();
}
export async function fetchDecks() {
    const response = await fetch(`${API_BASE_URL}/decks`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}
export async function fetchDeck(deckId) {
    const response = await fetch(`${API_BASE_URL}/decks/${deckId}`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}
export async function createDeck(payload) {
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
export async function updateDeck(deckId, payload) {
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
export async function fetchDeckStats(deckId) {
    const response = await fetch(`${API_BASE_URL}/decks/${deckId}/stats`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}
export async function fetchDeckCards(deckId, filters) {
    const response = await fetch(buildCardsUrl(deckId, filters));
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}
export async function fetchScryfallAutocomplete(query) {
    const params = new URLSearchParams({ query });
    const response = await fetch(`${API_BASE_URL}/scryfall/autocomplete?${params.toString()}`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}
export async function fetchScryfallCardByName(name) {
    const params = new URLSearchParams({ name });
    const response = await fetch(`${API_BASE_URL}/scryfall/card?${params.toString()}`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}
export async function createCard(deckId, payload) {
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
export async function updateCard(deckId, cardId, payload) {
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
export async function deleteCard(deckId, cardId) {
    const response = await fetch(`${API_BASE_URL}/decks/${deckId}/cards/${cardId}`, {
        method: "DELETE"
    });
    if (!response.ok) {
        throw await parseError(response);
    }
}
export async function importDecklist(deckId, decklistText) {
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
export async function fetchDecklistExport(deckId) {
    const response = await fetch(`${API_BASE_URL}/decks/${deckId}/export`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.text();
}
export async function fetchScryfallSearch(query, limit = 8) {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const response = await fetch(`${API_BASE_URL}/scryfall/search?${params.toString()}`);
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.json();
}

