import { parseCardFilters } from "@/lib/deck-browsing";
import DeckDetailClient from "@/components/DeckDetailClient";
import Link from "next/link";
import { notFound } from "next/navigation";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getDeckById, getDeckCards, getDeckPassportById, getDeckStatsById, getDeckValueById, getMulliganSampleById } from "@/lib/server/mtg-data";
import type { DeckValueTracker } from "@/lib/types";

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
    topRisers: [],
    topFallers: []
  };

  try {
    const [deck, cards, stats, valueTrackerResult, passportResult, mulliganResult] = await Promise.all([
      getDeckById(deckId, currentUser.id),
      getDeckCards(deckId, cardFilters, currentUser.id),
      getDeckStatsById(deckId, currentUser.id),
      getDeckValueById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: fallbackValueTracker, error: error instanceof Error ? error.message : "No se pudo cargar el valor del deck." })),
      getDeckPassportById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: null, error: error instanceof Error ? error.message : "Could not load the deck passport." })),
      getMulliganSampleById(deckId, currentUser.id)
        .then((value) => ({ ok: true as const, value, error: "" }))
        .catch((error) => ({ ok: false as const, value: null, error: error instanceof Error ? error.message : "Could not load the mulligan sample." }))
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
        initialCardFilters={cardFilters}
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
