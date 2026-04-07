"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDeckPurchase,
  deleteDeckPurchase,
  fetchBuyOpportunities,
  fetchDeckWishlistHistory
} from "@/lib/api";
import {
  buildSparklinePoints,
  buySignalClass,
  buySignalLabel,
  formatDisplayCurrency,
  formatDateTime,
  formatPercent,
  freshnessLabel,
  historyStatusDescription,
  historyStatusLabel,
  isLikelyStale,
  valueDeltaClass
} from "@/lib/collector-ui";
import { useUserPricingPreferences } from "@/lib/use-user-pricing-preferences";
import { validateWishlistPurchaseInput } from "@/lib/wishlist-purchase-validation";
import type {
  BuyOpportunities,
  BuyOpportunityFilters,
  BuyOpportunitySort,
  DeckWishlistHistory,
  UserPricingPreferences
} from "@/lib/types";

type BuyOpportunitiesClientProps = {
  initialData: BuyOpportunities;
  initialError: string;
  initialPreferences?: Partial<UserPricingPreferences>;
};


export default function BuyOpportunitiesClient({ initialData, initialError, initialPreferences }: BuyOpportunitiesClientProps) {
  const {
    preferences,
    error: preferencesError,
    setPreferredDisplayCurrency
  } = useUserPricingPreferences({
    preferredDisplayCurrency: "USD",
    showPriceFreshness: true,
    ...initialPreferences
  });
  const displayCurrency = preferences.preferredDisplayCurrency;
  const showPriceFreshness = preferences.showPriceFreshness;
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [sort, setSort] = useState<BuyOpportunitySort>(initialData.sort);
  const [signalFilter, setSignalFilter] = useState<BuyOpportunityFilters["signal"]>(initialData.filters.signal);
  const [deckFilter, setDeckFilter] = useState<BuyOpportunityFilters["deckId"]>(initialData.filters.deckId);
  const [historyFilter, setHistoryFilter] = useState<BuyOpportunityFilters["historyStatus"]>(initialData.filters.historyStatus);

  const [history, setHistory] = useState<DeckWishlistHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoadingKey, setHistoryLoadingKey] = useState<string | null>(null);

  const [activePurchaseKey, setActivePurchaseKey] = useState<string | null>(null);
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [purchasePriceUsd, setPurchasePriceUsd] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [deletingPurchaseKey, setDeletingPurchaseKey] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const load = async (next: {
    sort: BuyOpportunitySort;
    signal: BuyOpportunityFilters["signal"];
    deckId: BuyOpportunityFilters["deckId"];
    historyStatus: BuyOpportunityFilters["historyStatus"];
  }) => {
    const requestId = ++requestSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await fetchBuyOpportunities({
        sort: next.sort,
        signal: next.signal,
        deckId: next.deckId,
        historyStatus: next.historyStatus
      });
      if (requestSeqRef.current === requestId) {
        setData(result);
      }
    } catch (loadError) {
      if (requestSeqRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar oportunidades.");
      }
    } finally {
      if (requestSeqRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!history) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistory(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);

  const onApplyFilters = async (next: Partial<{
    sort: BuyOpportunitySort;
    signal: BuyOpportunityFilters["signal"];
    deckId: BuyOpportunityFilters["deckId"];
    historyStatus: BuyOpportunityFilters["historyStatus"];
  }>) => {
    const merged = {
      sort,
      signal: signalFilter,
      deckId: deckFilter,
      historyStatus: historyFilter,
      ...next
    };
    setSort(merged.sort);
    setSignalFilter(merged.signal);
    setDeckFilter(merged.deckId);
    setHistoryFilter(merged.historyStatus);
    await load(merged);
  };

  const onOpenHistory = async (deckId: number, wishlistItemId: number, key: string) => {
    setHistoryError("");
    setHistoryLoadingKey(key);
    try {
      const result = await fetchDeckWishlistHistory(deckId, wishlistItemId);
      setHistory(result);
    } catch (openError) {
      setHistory(null);
      setHistoryError(openError instanceof Error ? openError.message : "No se pudo cargar historial.");
    } finally {
      setHistoryLoadingKey(null);
    }
  };

  const onTogglePurchase = (key: string) => {
    setError("");
    setNotice("");
    if (activePurchaseKey === key) {
      setActivePurchaseKey(null);
      return;
    }
    setActivePurchaseKey(key);
    setPurchaseQuantity(1);
    setPurchasePriceUsd("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
  };

  const onCreatePurchase = async (deckId: number, wishlistItemId: number) => {
    if (purchaseSaving) {
      return;
    }
    const validated = validateWishlistPurchaseInput(purchaseQuantity, purchasePriceUsd, purchaseDate);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }

    setPurchaseSaving(true);
    setError("");
    setNotice("");
    try {
      await createDeckPurchase(deckId, {
        wishlistItemId,
        quantity: validated.quantity,
        unitPriceUsd: validated.unitPriceUsd,
        purchasedAt: purchaseDate
      });
      await load({ sort, signal: signalFilter, deckId: deckFilter, historyStatus: historyFilter });
      setNotice("Compra registrada.");
      setActivePurchaseKey(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo registrar compra.");
    } finally {
      setPurchaseSaving(false);
    }
  };

  const onDeletePurchase = async (deckId: number, purchaseId: number, key: string) => {
    if (deletingPurchaseKey === key) {
      return;
    }
    setDeletingPurchaseKey(key);
    setError("");
    try {
      await deleteDeckPurchase(deckId, purchaseId);
      await load({ sort, signal: signalFilter, deckId: deckFilter, historyStatus: historyFilter });
      setNotice("Compra eliminada.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar compra.");
    } finally {
      setDeletingPurchaseKey(null);
    }
  };

  const historySparkline = useMemo(() => (
    history ? buildSparklinePoints(history.points) : ""
  ), [history]);

  return (
    <section className="panel content">
      <div className="section-header-inline">
        <div>
          <h2>Buy Opportunities</h2>
          <p className="muted">Vista global de oportunidades de compra en tus wishlist por deck.</p>
          {showPriceFreshness && <p className="muted">Actualizado: {formatDateTime(data.generatedAt)}</p>}
          <p className="muted">Moneda: {displayCurrency}</p>
        </div>
        <div className="deck-wishlist-toolbar">
          <label className="field deck-wishlist-sort-field">
            <span>Moneda</span>
            <select value={displayCurrency} onChange={(event) => void setPreferredDisplayCurrency(event.target.value === "EUR" ? "EUR" : "USD")}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <button className="btn secondary" type="button" onClick={() => void load({ sort, signal: signalFilter, deckId: deckFilter, historyStatus: historyFilter })} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="buy-opps-toolbar">
        <label className="field">
          <span>Orden</span>
          <select value={sort} onChange={(event) => void onApplyFilters({ sort: event.target.value as BuyOpportunitySort })}>
            <option value="best-opportunity">Mejor oportunidad</option>
            <option value="highest-discount">Mayor descuento</option>
            <option value="card-name">Carta A-Z</option>
            <option value="deck-name">Deck A-Z</option>
            <option value="current-price">Precio actual</option>
          </select>
        </label>
        <label className="field">
          <span>Senal</span>
          <select value={signalFilter} onChange={(event) => void onApplyFilters({ signal: event.target.value as BuyOpportunityFilters["signal"] })}>
            <option value="all">Todas</option>
            <option value="good-moment">Buen momento</option>
            <option value="normal">En rango</option>
            <option value="expensive-now">Caro ahora</option>
          </select>
        </label>
        <label className="field">
          <span>Deck</span>
          <select value={deckFilter === "all" ? "all" : String(deckFilter)} onChange={(event) => void onApplyFilters({ deckId: event.target.value === "all" ? "all" : Number(event.target.value) })}>
            <option value="all">Todos</option>
            {data.availableDecks.map((deck) => (
              <option key={deck.id} value={deck.id}>{deck.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Historial</span>
          <select value={historyFilter} onChange={(event) => void onApplyFilters({ historyStatus: event.target.value as BuyOpportunityFilters["historyStatus"] })}>
            <option value="all">Todos</option>
            <option value="available">Disponible</option>
            <option value="limited">Limitado</option>
            <option value="unavailable">Sin datos</option>
          </select>
        </label>
      </div>

      {notice && <p className="notice-banner">{notice}</p>}
      {error && <p className="notice-banner error-banner">{error}</p>}
      {preferencesError && <p className="notice-banner error-banner">{preferencesError}</p>}
      {historyError && <p className="notice-banner error-banner">{historyError}</p>}

      {data.items.length === 0 && loading ? (
        <p className="muted">Cargando oportunidades...</p>
      ) : data.items.length === 0 ? (
        <div className="empty-state compact-empty-state">
          <p>No hay oportunidades para los filtros actuales.</p>
        </div>
      ) : (
        <div className="deck-wishlist-list">
          {loading && <p className="muted">Actualizando oportunidades...</p>}
          {data.items.map((item) => {
            const key = item.key;
            const signal = buySignalClass(item.pricing.signal);
            const deltaClass = valueDeltaClass(item.pricing.deltaPercent);
            const costDeltaClass = valueDeltaClass(item.costBasis.deltaPercent);
            const isHistoryLoading = historyLoadingKey === key;
            const isPurchaseOpen = activePurchaseKey === key;
            return (
              <article key={key} className="deck-wishlist-row">
                <div className="deck-wishlist-row-main">
                  <div className="deck-wishlist-heading">
                    <strong>
                      <Link className="inline-link" href={`/cards/${encodeURIComponent(item.resolvedIdentityKey)}`}>
                        {item.cardName}
                      </Link>
                    </strong>
                    <div className="deck-wishlist-badges">
                      <span className={`status-pill wishlist-signal-pill ${signal}`}>{buySignalLabel(item.pricing.signal)}</span>
                      {item.pricing.confidence === "limited" && <span className="status-pill">Datos parciales</span>}
                      <span className="status-pill">Objetivo: {item.targetQuantity}</span>
                    </div>
                  </div>
                  <div className="deck-wishlist-meta-row">
                    <span className="muted">Deck: <Link className="inline-link" href={`/decks/${item.deckId}`}>{item.deckName}</Link></span>
                    <span className="muted">Historial: {historyStatusLabel(item.pricing.historyStatus)}</span>
                    <span className="muted">{item.pricing.coverageReason}</span>
                    {showPriceFreshness && <span className="muted">Ultimo dato: {item.pricing.lastCapturedAt ? formatDateTime(item.pricing.lastCapturedAt) : "sin registro"}</span>}
                    {showPriceFreshness && <span className="muted">Estado: {freshnessLabel(item.pricing.lastCapturedAt)}</span>}
                    {showPriceFreshness && isLikelyStale(item.pricing.lastCapturedAt) && <span className="status-pill">Actualizacion antigua</span>}
                  </div>
                  <div className="deck-wishlist-metrics">
                    <span>Actual: <strong>{formatDisplayCurrency(item.pricing.currentPriceUsd, displayCurrency, "USD")}</strong></span>
                    <span>Referencia: <strong>{item.pricing.referencePriceUsd == null ? (item.pricing.comparisonReason ?? "Sin base comparable") : formatDisplayCurrency(item.pricing.referencePriceUsd, displayCurrency, "USD")}</strong></span>
                    <span className={`deck-wishlist-delta ${deltaClass}`}>
                      Variacion: <strong>{item.pricing.deltaUsd == null ? (item.pricing.comparisonReason ?? "Sin comparativa fiable") : `${formatDisplayCurrency(item.pricing.deltaUsd, displayCurrency, "USD")} (${formatPercent(item.pricing.deltaPercent)})`}</strong>
                    </span>
                  </div>
                  {item.costBasis.totalPurchasedQuantity > 0 && (
                    <div className="deck-wishlist-meta-row">
                      <span>Comprado: <strong>{item.costBasis.totalPurchasedQuantity}</strong></span>
                      <span>Coste medio: <strong>{formatDisplayCurrency(item.costBasis.averageCostBasisUsd, displayCurrency, "USD")}</strong></span>
                      <span className={`deck-wishlist-delta ${costDeltaClass}`}>
                        Valor actual: <strong>{item.costBasis.currentValueUsd == null ? "Sin precio actual" : formatDisplayCurrency(item.costBasis.currentValueUsd, displayCurrency, "USD")}</strong>
                      </span>
                    </div>
                  )}
                </div>

                <div className="deck-wishlist-actions">
                  <button className="btn secondary" type="button" onClick={() => void onOpenHistory(item.deckId, item.wishlistItemId, key)} disabled={isHistoryLoading}>
                    {isHistoryLoading ? "Cargando historial..." : "Historial"}
                  </button>
                  <button className="btn secondary" type="button" onClick={() => onTogglePurchase(key)} disabled={purchaseSaving}>
                    {isPurchaseOpen ? "Cerrar compra" : "Registrar compra"}
                  </button>
                </div>

                {isPurchaseOpen && (
                  <form
                    className="deck-wishlist-purchase-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onCreatePurchase(item.deckId, item.wishlistItemId);
                    }}
                  >
                    <label className="field deck-wishlist-purchase-field">
                      <span>Cantidad</span>
                      <input type="number" min={1} max={999} step={1} value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(Math.min(999, Math.max(1, Number(event.target.value) || 1)))} required />
                    </label>
                    <label className="field deck-wishlist-purchase-field">
                      <span>Precio unitario (USD)</span>
                      <input type="number" min={0} max={100000} step="0.01" inputMode="decimal" value={purchasePriceUsd} onChange={(event) => setPurchasePriceUsd(event.target.value)} required />
                    </label>
                    <label className="field deck-wishlist-purchase-field">
                      <span>Fecha</span>
                      <input type="date" value={purchaseDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setPurchaseDate(event.target.value)} required />
                    </label>
                    <button className="btn" type="submit" disabled={purchaseSaving}>{purchaseSaving ? "Guardando..." : "Guardar compra"}</button>
                  </form>
                )}

                {item.purchases.length > 0 && (
                  <div className="deck-wishlist-purchase-list">
                    {item.purchases.map((purchase) => {
                      const purchaseKey = `${key}:${purchase.id}`;
                      const deleting = deletingPurchaseKey === purchaseKey;
                      return (
                        <article key={purchase.id} className="deck-wishlist-purchase-row">
                          <div>
                            <strong>{purchase.quantity}x {formatDisplayCurrency(purchase.unitPriceUsd, displayCurrency, "USD")}</strong>
                            <p className="muted">{formatDateTime(purchase.purchasedAt)}</p>
                          </div>
                          <button className="btn secondary" type="button" onClick={() => void onDeletePurchase(item.deckId, purchase.id, purchaseKey)} disabled={deleting}>
                            {deleting ? "Eliminando..." : "Eliminar compra"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {history && (
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label={`Historial de ${history.cardName}`} onClick={() => setHistory(null)}>
          <div className="lightbox-panel deck-history-panel" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-inline">
              <strong>{history.cardName}</strong>
              <button className="btn secondary" type="button" onClick={() => setHistory(null)}>Cerrar</button>
            </div>
            <div className="deck-wishlist-badges">
              <span className="status-pill">{historyStatusLabel(history.status)}</span>
              {history.confidence === "limited" && <span className="status-pill">Lectura orientativa</span>}
            </div>
            <p className="muted">{historyStatusDescription(history.status)}</p>
            {historySparkline ? (
              <svg className="wishlist-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline points={historySparkline} />
              </svg>
            ) : (
              <p className="muted">{history.status === "unavailable" ? "No hay puntos locales para este historial." : "Historial limitado: pocos puntos disponibles."}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
