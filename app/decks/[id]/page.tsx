import { parseCardFilters } from "@/lib/deck-browsing";
import DeckDetailClient from "@/components/DeckDetailClient";
import Link from "next/link";
import { notFound } from "next/navigation";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getDeckById, getDeckCards, getDeckPassportById, getDeckStatsById, getDeckValueById, getDeckWishlistById, getMulliganSampleById } from "@/lib/server/mtg-data";
import type { DeckValueTracker, DeckWishlist } from "@/lib/types";

type DeckDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DeckDetailPage({ params, searchParams }: DeckDetailPageProps) {
  const { id } = await params;
  const currentUser = await redirectIfUnauthenticated(`/decks/${id}`);
  const deckId = Number(id);
  const cardFilters = parseCardFilters(await searchParams);

  if (!Number.isFinite(deckId)) {
    return (
      <section className="error-card">
        <h3>Invalid deck id</h3>
        <p className="muted">This route expects a numeric deck identifier.</p>
      </section>
    );
  }

  const fallbackValueTracker: DeckValueTracker = {
    deckId,
    currency: "USD",
    baselineValue: null,
    currentValue: null,
    deltaValue: null,
    deltaPercent: null,
    baselineCapturedAt: null,
    currentSnapshotAt: null,
    lastUpdated: null,
    usedStaleSnapshot: false,
    status: "unavailable",
    note: "El valor del deck no esta disponible ahora mismo.",
    pricedCardCount: 0,
    missingPriceCardCount: 0,
    comparableCardCount: 0,
    newlyPricedCardCount: 0,
    newlyPricedTotalValue: 0,
    lostPricedCardCount: 0,
    lostPricedTotalValue: 0,
    newlyPricedCards: [],
    lostPricedCards: [],
    topRisers: [],
    topFallers: []
  };

  const fallbackWishlist: DeckWishlist = {
    deckId,
    currency: "USD",
    generatedAt: new Date().toISOString(),
    sort: "best-opportunity",
    items: []
  };

  try {
    const [deck, cards, stats, valueTrackerResult, passportResult, mulliganResult, wishlistResult] = await Promise.all([
      getDeckById(deckId, currentUser.id),
      getDeckCards(deckId, cardFilters, currentUser.id),
      getDeckStatsById(deckId, currentUser.id),
      getDeckValueById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: fallbackValueTracker, error: error instanceof Error ? error.message : "No se pudo cargar el valor del deck." })),
      getDeckPassportById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: null, error: error instanceof Error ? error.message : "Could not load deck summary data." })),
      getMulliganSampleById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: null, error: error instanceof Error ? error.message : "Could not load the mulligan sample." })),
      getDeckWishlistById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: fallbackWishlist, error: error instanceof Error ? error.message : "No se pudo cargar la wishlist." }))
    ]);

    return (
      <DeckDetailClient
        initialDeck={deck}
        initialCards={cards}
        initialStats={stats}
        initialValueTracker={valueTrackerResult.value}
        initialValueTrackerError={valueTrackerResult.error}
        initialPassport={passportResult.ok ? passportResult.value : null}
        initialPassportError={passportResult.error}
        initialMulliganSample={mulliganResult.ok ? mulliganResult.value : null}
        initialMulliganError={mulliganResult.error}
        initialWishlist={wishlistResult.value}
        initialWishlistError={wishlistResult.error}
        initialCardFilters={cardFilters}
        initialPreferences={{
          preferredDisplayCurrency: currentUser.preferredDisplayCurrency ?? "USD",
          showPriceFreshness: currentUser.showPriceFreshness !== false
        }}
      />
    );
  } catch (error) {
    if (error instanceof Error && /status 404/.test(error.message)) {
      notFound();
    }
    const message = error instanceof Error ? error.message : "Could not load this deck.";
    return (
      <section className="error-card">
        <h3>Deck detail unavailable</h3>
        <p className="muted">{message}</p>
        <p>
          <Link className="inline-link" href="/decks">Return to deck list</Link>
        </p>
      </section>
    );
  }
}
