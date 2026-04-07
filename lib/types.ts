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

export type DeckValueCoverageCard = {
  key: string;
  cardId?: number | null;
  cardName: string;
  quantity: number;
  imageUrl?: string | null;
  scryfallId?: string | null;
  totalValue: number;
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
  comparableCardCount: number;
  newlyPricedCardCount: number;
  newlyPricedTotalValue: number;
  lostPricedCardCount: number;
  lostPricedTotalValue: number;
  newlyPricedCards: DeckValueCoverageCard[];
  lostPricedCards: DeckValueCoverageCard[];
  topRisers: DeckValueMover[];
  topFallers: DeckValueMover[];
};

export type DeckWishlistSignal = "good-moment" | "normal" | "expensive-now";

export type DeckWishlistConfidence = "full" | "limited";

export type DeckWishlistHistoryStatus = "available" | "limited" | "unavailable";

export type DeckWishlistSort = "best-opportunity" | "name" | "newest";

export type DeckWishlistPricePoint = {
  capturedAt: string;
  priceUsd: number;
  source: "cache" | "deck-snapshot";
};

export type DeckWishlistPricing = {
  currentPriceUsd: number | null;
  referencePriceUsd: number | null;
  deltaUsd: number | null;
  deltaPercent: number | null;
  signal: DeckWishlistSignal;
  confidence: DeckWishlistConfidence;
  historyStatus: DeckWishlistHistoryStatus;
  lastCapturedAt: string | null;
  coverageState: "ready" | "limited" | "missing";
  coverageReason: string;
  comparisonReason: string | null;
};

export type DeckWishlistPurchase = {
  id: number;
  ownerUserId?: number;
  deckId: number;
  wishlistItemId: number | null;
  resolvedIdentityKey: string;
  cardName: string;
  scryfallId: string | null;
  quantity: number;
  unitPriceUsd: number;
  purchasedAt: string;
  createdAt: string;
};

export type DeckWishlistCostBasis = {
  totalPurchasedQuantity: number;
  averageCostBasisUsd: number | null;
  totalCostBasisUsd: number | null;
  currentValueUsd: number | null;
  deltaUsd: number | null;
  deltaPercent: number | null;
};

export type DeckWishlistItem = {
  id: number;
  ownerUserId?: number;
  deckId: number;
  cardName: string;
  scryfallId: string | null;
  resolvedIdentityKey: string;
  targetQuantity: number;
  createdAt: string;
  updatedAt: string;
  pricing: DeckWishlistPricing;
  purchases: DeckWishlistPurchase[];
  costBasis: DeckWishlistCostBasis;
};

export type DeckWishlist = {
  deckId: number;
  currency: string;
  generatedAt: string;
  sort: DeckWishlistSort;
  items: DeckWishlistItem[];
};

export type DeckWishlistHistory = {
  deckId: number;
  wishlistItemId: number;
  cardName: string;
  scryfallId: string | null;
  resolvedIdentityKey: string;
  status: DeckWishlistHistoryStatus;
  confidence: DeckWishlistConfidence;
  points: DeckWishlistPricePoint[];
};

export type DeckWishlistRefreshResult = {
  deckId: number;
  refreshedAt: string;
  ttlHours: number;
  scannedItems: number;
  staleItems: number;
  refreshedItems: number;
  unresolvedItems: number;
  note: string;
  diagnostics?: {
    totalTargets: number;
    staleTargets: number;
    missingIdentityTargets: number;
    unresolvedIdentityTargets: number;
    sampledUnresolvedCards: string[];
  };
};

export type BuyOpportunitySort =
  | "best-opportunity"
  | "highest-discount"
  | "card-name"
  | "deck-name"
  | "current-price";

export type BuyOpportunityFilters = {
  signal: "all" | DeckWishlistSignal;
  deckId: "all" | number;
  historyStatus: "all" | DeckWishlistHistoryStatus;
};

export type BuyOpportunityDeckOption = {
  id: number;
  name: string;
};

export type BuyOpportunityItem = {
  key: string;
  deckId: number;
  deckName: string;
  wishlistItemId: number;
  cardName: string;
  scryfallId: string | null;
  resolvedIdentityKey: string;
  targetQuantity: number;
  createdAt: string;
  updatedAt: string;
  pricing: DeckWishlistPricing;
  purchases: DeckWishlistPurchase[];
  costBasis: DeckWishlistCostBasis;
};

export type BuyOpportunities = {
  generatedAt: string;
  currency: string;
  sort: BuyOpportunitySort;
  filters: BuyOpportunityFilters;
  availableDecks: BuyOpportunityDeckOption[];
  items: BuyOpportunityItem[];
};

export type CollectorOverviewSort =
  | "biggest-gain"
  | "biggest-loss"
  | "total-value"
  | "total-cost"
  | "card-name"
  | "latest-purchase";

export type CollectorOverviewProfitability = "all" | "profitable" | "unprofitable" | "flat";

export type CollectorOverviewPriceDataFilter = "all" | "limited-or-unavailable";

export type CollectorOverviewFilters = {
  deckId: "all" | number;
  profitability: CollectorOverviewProfitability;
  priceData: CollectorOverviewPriceDataFilter;
};

export type CollectorOverviewPurchase = {
  id: number;
  deckId: number;
  deckName: string;
  wishlistItemId: number | null;
  quantity: number;
  unitPriceUsd: number;
  purchasedAt: string;
  createdAt: string;
};

export type CollectorOverviewDeckLink = {
  id: number;
  name: string;
  wishlistItemId: number | null;
};

export type CollectorOverviewItem = {
  key: string;
  cardName: string;
  scryfallId: string | null;
  resolvedIdentityKey: string;
  decks: CollectorOverviewDeckLink[];
  totalPurchasedQuantity: number;
  averageCostBasisUsd: number | null;
  totalCostUsd: number | null;
  currentUnitPriceUsd: number | null;
  currentTotalValueUsd: number | null;
  deltaUsd: number | null;
  deltaPercent: number | null;
  latestPurchaseAt: string | null;
  lastPriceCapturedAt: string | null;
  priceDataStatus: DeckWishlistHistoryStatus;
  confidence: DeckWishlistConfidence;
  purchases: CollectorOverviewPurchase[];
  primaryDeckId: number;
  primaryWishlistItemId: number | null;
};

export type CollectorOverview = {
  generatedAt: string;
  currency: string;
  sort: CollectorOverviewSort;
  filters: CollectorOverviewFilters;
  availableDecks: BuyOpportunityDeckOption[];
  items: CollectorOverviewItem[];
};

export type CardDetailDeckUsage = {
  deckId: number;
  deckName: string;
  quantity: number;
  inDeck: boolean;
  wishlistItemId: number | null;
  wishlistTargetQuantity: number | null;
};

export type CardDetailPricing = {
  currentPriceUsd: number | null;
  referencePriceUsd: number | null;
  deltaUsd: number | null;
  deltaPercent: number | null;
  signal: DeckWishlistSignal;
  confidence: DeckWishlistConfidence;
  historyStatus: DeckWishlistHistoryStatus;
  lastCapturedAt: string | null;
  coverageState: "ready" | "limited" | "missing";
  coverageReason: string;
  comparisonReason: string | null;
};

export type CardDetailPurchase = CollectorOverviewPurchase;

export type CardDetail = {
  identity: string;
  cardName: string;
  scryfallId: string | null;
  currency: string;
  generatedAt: string;
  pricing: CardDetailPricing;
  history: DeckWishlistPricePoint[];
  decks: CardDetailDeckUsage[];
  wishlistDecks: CardDetailDeckUsage[];
  purchases: CardDetailPurchase[];
  costBasis: DeckWishlistCostBasis;
};

export type DeckAssistantCutCategory =
  | "curve-pressure"
  | "too-slow"
  | "low-impact"
  | "redundant-effect"
  | "weak-standalone-value"
  | "win-more"
  | "low-synergy";

export type DeckCutSuggestion = {
  cardId: number;
  cardName: string;
  quantity: number;
  manaValue: number;
  category: DeckAssistantCutCategory;
  reason: string;
  score: number;
};

export type DeckCutSuggestions = {
  deckId: number;
  commander: string;
  generatedAt: string;
  status: "ready" | "partial" | "unavailable";
  summary: string;
  warnings: string[];
  suggestions: DeckCutSuggestion[];
};

export type DeckBudgetUpgradeSuggestion = {
  cardName: string;
  estimatedPriceUsd: number | null;
  suggestedCutCardName?: string | null;
  improves: string;
  reason: string;
  imageUrl?: string | null;
};

export type DeckBudgetUpgrades = {
  deckId: number;
  commander: string;
  requestedBudgetUsd: number;
  totalEstimatedSpendUsd: number;
  remainingBudgetUsd: number;
  generatedAt: string;
  status: "ready" | "partial" | "unavailable";
  summary: string;
  warnings: string[];
  suggestions: DeckBudgetUpgradeSuggestion[];
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
  authProvider?: "local" | "google";
  emailVerified?: boolean;
  preferredDisplayCurrency?: "USD" | "EUR";
  showPriceFreshness?: boolean;
};

export type UserPricingPreferences = {
  preferredDisplayCurrency: "USD" | "EUR";
  showPriceFreshness: boolean;
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

export type RulesHelperIntent = "rules" | "interaction" | "card-lookup";

export type RulesHelperStackUsage = "Yes" | "No" | "Sometimes" | null;

export type RulesHelperResult = {
  intent: RulesHelperIntent;
  query: string;
  title: string;
  shortAnswer: string;
  note: string;
  stackUsage: RulesHelperStackUsage;
  cards: CardLookupResult[];
  examples: string[];
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
