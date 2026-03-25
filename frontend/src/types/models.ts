export type Deck = {
  id: number;
  name: string;
  format: string;
  commander: string;
  createdAt: string;
};

export type Card = {
  id: number;
  name: string;
  manaValue: number;
  type: string;
  colors: string;
  quantity: number;
};

export type DeckStats = {
  totalCards: number;
  byColor: Record<string, number>;
  byType: Record<string, number>;
  manaCurve: Record<string, number>;
};

export type ImportResult = {
  importedCount: number;
  createdCards: Array<{ id: number; name: string; quantity: number }>;
  errors: Array<{ line: number; message: string; rawLine: string }>;
};

export type CardFilters = {
  name: string;
  type: string;
  color: string;
  sort: string;
};

export type ApiErrorResponse = {
  message?: string;
  errors?: string[];
};

export type CardLookupResult = {
  name: string;
  manaValue: number;
  type: string;
  colors: string;
};
