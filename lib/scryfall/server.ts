import "server-only";

import type { CardLookupResult, CardPriceLookupResult } from "@/lib/types";

const SCRYFALL_API_BASE_URL = "https://api.scryfall.com";
const SCRYFALL_HEADERS = {
  Accept: "application/json",
  "User-Agent": "mtg-deck-manager/1.0"
};

type ScryfallImageUris = {
  normal?: string | null;
  small?: string | null;
};

type ScryfallCardFace = {
  image_uris?: ScryfallImageUris | null;
};

type ScryfallCard = {
  id?: string | null;
  name?: string | null;
  cmc?: number | null;
  type_line?: string | null;
  colors?: string[] | null;
  prices?: {
    usd?: string | null;
  } | null;
  image_uris?: ScryfallImageUris | null;
  card_faces?: ScryfallCardFace[] | null;
};

type ScryfallAutocompleteResponse = {
  data?: string[] | null;
};

class ScryfallRouteError extends Error {
  status: number;
  errors: string[];
  code: string;

  constructor(status: number, message: string, errors: string[] = [], code = "lookup_failed") {
    super(message);
    this.name = "ScryfallRouteError";
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

export { ScryfallRouteError };

function validationError(message: string) {
  return new ScryfallRouteError(400, "Validation failed", [message]);
}

async function fetchScryfallJson<T>(path: string, searchParams: URLSearchParams): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    return await fetch(`${SCRYFALL_API_BASE_URL}${path}?${searchParams.toString()}`, {
      method: "GET",
      headers: SCRYFALL_HEADERS,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ScryfallRouteError(504, "Card lookup timed out", [], "timeout");
    }

    throw new ScryfallRouteError(502, "Card lookup service is unavailable", [], "network");
  } finally {
    clearTimeout(timeout);
  }
}

async function postScryfallJson(path: string, payload: unknown): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    return await fetch(`${SCRYFALL_API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        ...SCRYFALL_HEADERS,
        "Content-Type": "application/json"
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ScryfallRouteError(504, "Card lookup timed out", [], "timeout");
    }

    throw new ScryfallRouteError(502, "Card lookup service is unavailable", [], "network");
  } finally {
    clearTimeout(timeout);
  }
}

type ScryfallErrorResponse = {
  details?: string | null;
  warnings?: string[] | null;
  code?: string | null;
};

async function buildScryfallStatusError(response: Response, fallbackCode: string) {
  let details = "";
  try {
    const payload = (await response.json()) as ScryfallErrorResponse;
    details = payload.details?.trim() || "";
  } catch {
    details = "";
  }

  const message = details || `Card lookup request failed with status ${response.status}`;

  if (response.status === 404) {
    return new ScryfallRouteError(404, message, [], "not_found");
  }

  if (response.status === 429) {
    return new ScryfallRouteError(429, message, [], "rate_limited");
  }

  if (response.status >= 500) {
    return new ScryfallRouteError(response.status, message, [], "upstream_server");
  }

  return new ScryfallRouteError(response.status, message, [], fallbackCode);
}

function colorsToText(colors: string[] | null | undefined) {
  if (!colors || colors.length === 0) {
    return "C";
  }

  return colors.join(",");
}

function resolveImages(card: ScryfallCard) {
  if (card.image_uris?.small || card.image_uris?.normal) {
    return {
      imageSmall: card.image_uris.small ?? null,
      imageNormal: card.image_uris.normal ?? null
    };
  }

  for (const face of card.card_faces ?? []) {
    if (face.image_uris?.small || face.image_uris?.normal) {
      return {
        imageSmall: face.image_uris.small ?? null,
        imageNormal: face.image_uris.normal ?? null
      };
    }
  }

  return {
    imageSmall: null,
    imageNormal: null
  };
}

function parsePriceNumber(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCardLookupResult(card: ScryfallCard): CardLookupResult {
  const images = resolveImages(card);

  return {
    name: card.name ?? "",
    manaValue: card.cmc == null ? 0 : Math.trunc(card.cmc),
    type: card.type_line ?? "Unknown",
    colors: colorsToText(card.colors),
    scryfallId: card.id ?? null,
    imageSmall: images.imageSmall,
    imageNormal: images.imageNormal
  };
}

export function toCardPriceLookupResult(card: ScryfallCard): CardPriceLookupResult {
  const base = toCardLookupResult(card);
  return {
    ...base,
    priceUsd: parsePriceNumber(card.prices?.usd)
  };
}

export function toErrorResponse(error: unknown) {
  const routeError = error instanceof ScryfallRouteError
    ? error
    : new ScryfallRouteError(502, "Card lookup service is unavailable");

  return Response.json(
    {
      message: routeError.message,
      errors: routeError.errors
    },
    { status: routeError.status }
  );
}

export async function autocompleteCards(query: string): Promise<string[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw validationError("query must not be blank");
  }

  const params = new URLSearchParams({ q: trimmedQuery });
  const response = await fetchScryfallJson<ScryfallAutocompleteResponse>("/cards/autocomplete", params);

  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallAutocompleteResponse;
  return payload.data ?? [];
}

export async function getCardByExactName(name: string): Promise<CardLookupResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw validationError("name must not be blank");
  }

  const params = new URLSearchParams({ exact: trimmedName });
  const response = await fetchScryfallJson<ScryfallCard>("/cards/named", params);

  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallCard;
  if (!payload.name || payload.name.trim().length === 0) {
    throw new ScryfallRouteError(404, "Card not found", [], "not_found");
  }

  return toCardLookupResult(payload);
}

export async function getCardByFuzzyName(name: string): Promise<CardLookupResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw validationError("name must not be blank");
  }

  const params = new URLSearchParams({ fuzzy: trimmedName });
  const response = await fetchScryfallJson<ScryfallCard>("/cards/named", params);

  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallCard;
  if (!payload.name || payload.name.trim().length === 0) {
    throw new ScryfallRouteError(404, "Card not found", [], "not_found");
  }

  return toCardLookupResult(payload);
}

export async function getCardPriceByExactName(name: string): Promise<CardPriceLookupResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw validationError("name must not be blank");
  }

  const params = new URLSearchParams({ exact: trimmedName });
  const response = await fetchScryfallJson<ScryfallCard>("/cards/named", params);

  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallCard;
  if (!payload.name || payload.name.trim().length === 0) {
    throw new ScryfallRouteError(404, "Card not found", [], "not_found");
  }

  return toCardPriceLookupResult(payload);
}

export async function getCardPriceByFuzzyName(name: string): Promise<CardPriceLookupResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw validationError("name must not be blank");
  }

  const params = new URLSearchParams({ fuzzy: trimmedName });
  const response = await fetchScryfallJson<ScryfallCard>("/cards/named", params);

  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallCard;
  if (!payload.name || payload.name.trim().length === 0) {
    throw new ScryfallRouteError(404, "Card not found", [], "not_found");
  }

  return toCardPriceLookupResult(payload);
}

type ScryfallSearchResponse = {
  data?: ScryfallCard[] | null;
};

type ScryfallCollectionIdentifier = {
  id?: string;
  name?: string;
};

type ScryfallCollectionResponse = {
  data?: ScryfallCard[] | null;
  not_found?: ScryfallCollectionIdentifier[] | null;
};

export async function getCardPricesByCollection(identifiers: ScryfallCollectionIdentifier[]): Promise<{
  data: CardPriceLookupResult[];
  notFound: ScryfallCollectionIdentifier[];
}> {
  const filteredIdentifiers = identifiers
    .map((identifier) => ({
      id: identifier.id?.trim(),
      name: identifier.name?.trim()
    }))
    .filter((identifier) => Boolean(identifier.id || identifier.name));

  if (filteredIdentifiers.length === 0) {
    return { data: [], notFound: [] };
  }

  if (filteredIdentifiers.length > 75) {
    throw validationError("collection lookups support at most 75 identifiers");
  }

  const response = await postScryfallJson("/cards/collection", { identifiers: filteredIdentifiers });
  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallCollectionResponse;
  return {
    data: (payload.data ?? []).map(toCardPriceLookupResult),
    notFound: (payload.not_found ?? []).map((identifier) => ({
      id: identifier.id?.trim(),
      name: identifier.name?.trim()
    }))
  };
}

export async function searchCards(query: string, limit: number): Promise<CardLookupResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw validationError("query must not be blank");
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw validationError("limit must be between 1 and 20");
  }

  const params = new URLSearchParams({
    q: trimmedQuery,
    order: "name",
    unique: "cards",
    include_extras: "false"
  });
  const response = await fetchScryfallJson<ScryfallSearchResponse>("/cards/search", params);

  if (response.status === 404) {
    return [];
  }

  if (response.status >= 400) {
    throw await buildScryfallStatusError(response, "invalid_request");
  }

  const payload = (await response.json()) as ScryfallSearchResponse;
  return (payload.data ?? []).slice(0, Math.max(1, limit)).map(toCardLookupResult);
}
