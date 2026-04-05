export type Deck = {
  id: number;
  ownerUserId?: number;
  name: string;
  format: string;
  commander: string;
  createdAt: string;
  totalCardCount?: number;
  cardPreview?: string[];
  deckCoverUrl?: string | null;
};

export type DeckValueMover = {
  key: string;
  cardId?: number | null;
  cardName: string;
  quantity: number;
  imageUrl?: string | null;
  scryfallId?: string | null;
  baselineTotalValue: number;
  currentTotalValue: number;
  deltaValue: number;
  deltaPercent: number | null;
};

export type DeckValueTracker = {
  deckId: number;
  currency: string;
  baselineValue: number | null;
  currentValue: number | null;
  deltaValue: number | null;
  deltaPercent: number | null;
  baselineCapturedAt: string | null;
  currentSnapshotAt: string | null;
  lastUpdated: string | null;
  usedStaleSnapshot: boolean;
  status: "empty" | "ready" | "partial" | "stale" | "unavailable";
  note: string;
  pricedCardCount: number;
  missingPriceCardCount: number;
  topRisers: DeckValueMover[];
  topFallers: DeckValueMover[];
};

export type PortfolioDeckValue = {
  deck: Deck;
  tracker: DeckValueTracker;
};

export type DeckPortfolioSummary = {
  currency: string;
  deckCount: number;
  totalBaselineValue: number | null;
  totalCurrentValue: number | null;
  totalDeltaValue: number | null;
  totalDeltaPercent: number | null;
  lastUpdated: string | null;
};

export type DeckPortfolio = {
  currency: string;
  summary: DeckPortfolioSummary;
  decks: PortfolioDeckValue[];
};

export type User = {
  id: number;
  email: string;
  createdAt: string;
  isBootstrapLegacyOwner?: boolean;
};

export type Session = {
  id: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
};

export type Card = {
  id: number;
  name: string;
  manaValue: number;
  type: string;
  colors: string;
  quantity: number;
  scryfallId?: string | null;
  imageSmall?: string | null;
  imageNormal?: string | null;
  imageUrl?: string | null;
};

export type DeckStats = {
  totalCards: number;
  byColor: Record<string, number>;
  byType: Record<string, number>;
  manaCurve: Record<string, number>;
};

export type ImportPipelineReport = {
  detectedSource: string;
  totalPastedLines: number;
  ignoredBlankLines: number;
  ignoredSectionLines: number;
  ignoredLines: number;
  parsedLines: number;
  recognizedCards: number;
  unresolvedLines: number;
  parseFailures: number;
  unresolvedCardLookups: number;
  normalizedExactLookups: number;
  fuzzyLookups: number;
  fallbackImportedCards: number;
  metadataEnrichedCards: number;
  metadataPendingCards: number;
  lookupFailuresByReason: Record<string, number>;
  metadataEnrichmentFailuresByReason: Record<string, number>;
  duplicatesConsolidated: number;
  actuallyImportedCards: number;
  skippedOrFailedImports: number;
  commanderDetection: string;
};

export type ImportResult = {
  importedCount: number;
  createdCards: Array<{ id: number; name: string; quantity: number }>;
  updatedCards: Array<{ id: number; name: string; quantity: number }>;
  errors: Array<{ kind?: "parse" | "lookup"; line: number; message: string; rawLine: string; lookupCode?: string; lookupStatus?: number }>;
  pipeline: ImportPipelineReport;
};

export type DeckListFilters = {
  query: string;
  format: string;
  sort: string;
};

export type CardFilters = {
  name: string;
  type: string;
  color: string;
  sort: string;
};

export type CardLookupResult = {
  name: string;
  manaValue: number;
  type: string;
  colors: string;
  scryfallId?: string | null;
  imageSmall?: string | null;
  imageNormal?: string | null;
};

export type CardPriceLookupResult = CardLookupResult & {
  priceUsd: number | null;
};

export type DeckPassport = {
  deckName: string;
  format: string;
  commander: string;
  colors: string[];
  totalCards: number;
  byType: Record<string, number>;
  manaCurve: Record<string, number>;
  gamePlan: string;
  winPlan: string;
  earlyGamePlan: string;
  roles: {
    ramp: number;
    draw: number;
    removal: number;
    boardWipes: number;
    protection: number;
    finishers: number;
  };
  warnings: string[];
  rulesWatchouts: Array<{
    label: string;
    description: string;
    commonStackUsage: string;
    practicalNote: string;
  }>;
};

export type MulliganSample = {
  cards: Array<{
    name: string;
    manaValue: number;
    type: string;
    isLand: boolean;
    imageUrl?: string | null;
  }>;
  verdict: "Keep" | "Borderline" | "Mulligan";
  landCount: number;
  hasEarlyPlayable: boolean;
  hasColorAccess: boolean;
  hasRamp: boolean;
  hasDraw: boolean;
  fitsEarlyCurve: boolean;
  note: string;
  signals: string[];
};

export type ApiErrorResponse = {
  message?: string;
  errors?: string[];
};
