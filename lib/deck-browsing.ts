import type { CardFilters, DeckListFilters } from "@/lib/types";

type SearchParamInput =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

export const DEFAULT_DECK_LIST_FILTERS: DeckListFilters = {
  query: "",
  format: "",
  sort: "newest"
};

export const DEFAULT_CARD_FILTERS: CardFilters = {
  name: "",
  type: "",
  color: "",
  sort: "name:asc"
};

function getParamValue(input: SearchParamInput, key: string): string {
  const searchParamReader = input as { get?: (name: string) => string | null };
  if (typeof searchParamReader.get === "function") {
    return searchParamReader.get(key)?.trim() ?? "";
  }

  const recordInput = input as Record<string, string | string[] | undefined>;
  const value = recordInput[key];
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }

  return value?.trim() ?? "";
}

export function parseDeckListFilters(input: SearchParamInput): DeckListFilters {
  return {
    query: getParamValue(input, "query"),
    format: getParamValue(input, "format"),
    sort: getParamValue(input, "sort") || DEFAULT_DECK_LIST_FILTERS.sort
  };
}

export function parseCardFilters(input: SearchParamInput): CardFilters {
  return {
    name: getParamValue(input, "name"),
    type: getParamValue(input, "type"),
    color: getParamValue(input, "color"),
    sort: getParamValue(input, "sort") || DEFAULT_CARD_FILTERS.sort
  };
}

export function buildDeckListSearchParams(filters: DeckListFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query.trim()) {
    params.set("query", filters.query.trim());
  }

  if (filters.format.trim()) {
    params.set("format", filters.format.trim());
  }

  if (filters.sort && filters.sort !== DEFAULT_DECK_LIST_FILTERS.sort) {
    params.set("sort", filters.sort);
  }

  return params;
}

export function buildCardSearchParams(filters: CardFilters): URLSearchParams {
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

  if (filters.sort && filters.sort !== DEFAULT_CARD_FILTERS.sort) {
    params.set("sort", filters.sort);
  }

  return params;
}

export function buildSpringCardQuery(filters: Partial<CardFilters> = {}): URLSearchParams {
  const normalized: CardFilters = {
    ...DEFAULT_CARD_FILTERS,
    ...filters
  };
  const params = new URLSearchParams();

  if (normalized.name.trim()) {
    params.set("name", normalized.name.trim());
  }

  if (normalized.type.trim()) {
    params.set("type", normalized.type.trim());
  }

  if (normalized.color.trim()) {
    params.set("color", normalized.color.trim());
  }

  const [sortBy, direction] = normalized.sort.split(":");
  if (sortBy) {
    params.set("sortBy", sortBy);
  }
  if (direction) {
    params.set("direction", direction);
  }

  return params;
}
