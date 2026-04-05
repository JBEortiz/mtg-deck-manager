import Link from "next/link";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getDeckPortfolioByOwner, getDecksByOwner } from "@/lib/server/mtg-data";

function formatCurrency(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) {
    return "Pendiente";
  }

  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "Pendiente";
  }

  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function deltaClass(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "neutral";
  }

  return value > 0 ? "positive" : "negative";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Pendiente";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default async function PortfolioPage() {
  const currentUser = await redirectIfUnauthenticated("/portfolio");
  const [portfolio, decks] = await Promise.all([
    getDeckPortfolioByOwner(currentUser.id),
    getDecksByOwner(currentUser.id)
  ]);

  const deckById = new Map(decks.map((deck) => [deck.id, deck]));

  return (
    <div className="page-stack">
      <section className="panel portfolio-hero">
        <div className="section-header-inline">
          <div>
            <p className="eyebrow">Portfolio</p>
            <h2>Valor de tus decks</h2>
            <p className="muted">Una vista compacta de lo que valian al entrar y de su valor actual.</p>
          </div>
          <Link className="btn secondary" href="/decks">Volver a decks</Link>
        </div>

        <div className="portfolio-summary-grid">
          <article className="portfolio-summary-card">
            <span className="deck-value-label">Valor actual</span>
            <strong className="deck-value-number">{formatCurrency(portfolio.summary.totalCurrentValue, portfolio.currency)}</strong>
            <p className="deck-value-meta">Actualizado: {formatDateTime(portfolio.summary.lastUpdated)}</p>
          </article>
          <article className="portfolio-summary-card">
            <span className="deck-value-label">Valor inicial</span>
            <strong className="deck-value-number">{formatCurrency(portfolio.summary.totalBaselineValue, portfolio.currency)}</strong>
            <p className="deck-value-meta">{portfolio.summary.deckCount} deck(s) incluidos</p>
          </article>
          <article className={`portfolio-summary-card deck-value-delta ${deltaClass(portfolio.summary.totalDeltaValue)}`}>
            <span className="deck-value-label">Cambio total</span>
            <strong className="deck-value-number">{formatCurrency(portfolio.summary.totalDeltaValue, portfolio.currency)}</strong>
            <p className="deck-value-meta">{formatPercent(portfolio.summary.totalDeltaPercent)}</p>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="section-header-inline">
          <div>
            <h3>Decks en cartera</h3>
            <p className="muted">La lista sigue siendo deck-first: portada, comandante y cambio de valor por deck.</p>
          </div>
          <span className="status-badge">{portfolio.decks.length}</span>
        </div>

        {portfolio.decks.length === 0 ? (
          <div className="empty-state">
            <h3>Sin decks todavia</h3>
            <p>Crea o importa un deck para empezar a seguir su valor.</p>
          </div>
        ) : (
          <div className="portfolio-deck-grid">
            {portfolio.decks.map((entry) => {
              const deck = deckById.get(entry.deck.id) ?? entry.deck;
              return (
                <Link key={entry.deck.id} className="portfolio-deck-card" href={`/decks/${entry.deck.id}`}>
                  <div className="portfolio-deck-cover">
                    {deck.deckCoverUrl ? (
                      <img className="deck-cover-image" src={deck.deckCoverUrl} alt={entry.deck.name} loading="lazy" />
                    ) : (
                      <div className="deck-cover-placeholder">Sin imagen</div>
                    )}
                  </div>
                  <div className="portfolio-deck-copy">
                    <strong>{entry.deck.name}</strong>
                    <span>{entry.deck.commander || "Sin comandante"}</span>
                    <span>{entry.deck.format} · {deck.totalCardCount ?? 0} cartas</span>
                  </div>
                  <div className="portfolio-deck-metrics">
                    <div>
                      <span className="deck-value-label">Inicial</span>
                      <strong>{formatCurrency(entry.tracker.baselineValue, entry.tracker.currency)}</strong>
                    </div>
                    <div>
                      <span className="deck-value-label">Ahora</span>
                      <strong>{formatCurrency(entry.tracker.currentValue, entry.tracker.currency)}</strong>
                    </div>
                    <div className={`portfolio-delta ${deltaClass(entry.tracker.deltaValue)}`}>
                      <span className="deck-value-label">Cambio</span>
                      <strong>{formatCurrency(entry.tracker.deltaValue, entry.tracker.currency)}</strong>
                      <span>{formatPercent(entry.tracker.deltaPercent)}</span>
                    </div>
                  </div>
                  <div className="portfolio-deck-footer">
                    <span className={`status-pill ${entry.tracker.status === "stale" ? "status-error" : entry.tracker.status === "partial" ? "" : "status-ok"}`}>
                      {entry.tracker.status === "ready"
                        ? "Actualizado"
                        : entry.tracker.status === "partial"
                          ? "Parcial"
                          : entry.tracker.status === "stale"
                            ? "Snapshot previo"
                            : entry.tracker.status === "empty"
                              ? "Sin cartas"
                              : "Pendiente"}
                    </span>
                    <span className="muted">{formatDateTime(entry.tracker.lastUpdated)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
