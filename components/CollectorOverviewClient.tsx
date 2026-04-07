"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDeckPurchase,
  deleteDeckPurchase,
  fetchCollectorOverview,
  fetchDeckWishlistHistory
} from "@/lib/api";
import {
  buildSparklinePoints,
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
  CollectorOverview,
  CollectorOverviewFilters,
  CollectorOverviewSort,
  DeckWishlistHistory,
  UserPricingPreferences
} from "@/lib/types";

type CollectorOverviewClientProps = {
  initialData: CollectorOverview;
  initialError: string;
  initialPreferences?: Partial<UserPricingPreferences>;
};

function profitabilityLabel(value: number | null) {
  if (value == null || value === 0) {
    return "Sin cambio";
  }
  return value > 0 ? "En positivo" : "En negativo";
}

export default function CollectorOverviewClient({ initialData, initialError, initialPreferences }: CollectorOverviewClientProps) {
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
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const [sort, setSort] = useState<CollectorOverviewSort>(initialData.sort);
  const [deckFilter, setDeckFilter] = useState<CollectorOverviewFilters["deckId"]>(initialData.filters.deckId);
  const [profitabilityFilter, setProfitabilityFilter] = useState<CollectorOverviewFilters["profitability"]>(initialData.filters.profitability);
  const [priceDataFilter, setPriceDataFilter] = useState<CollectorOverviewFilters["priceData"]>(initialData.filters.priceData);

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
    sort: CollectorOverviewSort;
    deckId: CollectorOverviewFilters["deckId"];
    profitability: CollectorOverviewFilters["profitability"];
    priceData: CollectorOverviewFilters["priceData"];
  }) => {
    const requestId = ++requestSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await fetchCollectorOverview(next);
      if (requestSeqRef.current === requestId) {
        setData(result);
      }
    } catch (loadError) {
      if (requestSeqRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el overview.");
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
    sort: CollectorOverviewSort;
    deckId: CollectorOverviewFilters["deckId"];
    profitability: CollectorOverviewFilters["profitability"];
    priceData: CollectorOverviewFilters["priceData"];
  }>) => {
    const merged = {
      sort,
      deckId: deckFilter,
      profitability: profitabilityFilter,
      priceData: priceDataFilter,
      ...next
    };
    setSort(merged.sort);
    setDeckFilter(merged.deckId);
    setProfitabilityFilter(merged.profitability);
    setPriceDataFilter(merged.priceData);
    await load(merged);
  };

  const onOpenHistory = async (deckId: number, wishlistItemId: number | null, rowKey: string) => {
    if (wishlistItemId == null) {
      setHistoryError("Este registro no tiene un wishlist item activo para abrir historial.");
      return;
    }
    setHistoryError("");
    setHistoryLoadingKey(rowKey);
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

  const onTogglePurchase = (rowKey: string) => {
    setNotice("");
    setError("");
    if (activePurchaseKey === rowKey) {
      setActivePurchaseKey(null);
      return;
    }
    setActivePurchaseKey(rowKey);
    setPurchaseQuantity(1);
    setPurchasePriceUsd("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
  };

  const onCreatePurchase = async (deckId: number, wishlistItemId: number | null) => {
    if (purchaseSaving) {
      return;
    }
    if (wishlistItemId == null) {
      setError("No hay wishlist item activo para registrar compra desde esta fila.");
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
      await load({ sort, deckId: deckFilter, profitability: profitabilityFilter, priceData: priceDataFilter });
      setNotice("Compra registrada.");
      setActivePurchaseKey(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo registrar compra.");
    } finally {
      setPurchaseSaving(false);
    }
  };

  const onDeletePurchase = async (deckId: number, purchaseId: number, purchaseKey: string) => {
    if (deletingPurchaseKey === purchaseKey) {
      return;
    }
    setDeletingPurchaseKey(purchaseKey);
    setError("");
    try {
      await deleteDeckPurchase(deckId, purchaseId);
      await load({ sort, deckId: deckFilter, profitability: profitabilityFilter, priceData: priceDataFilter });
      setNotice("Compra eliminada.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "No se pudo eliminar compra.");
    } finally {
      setDeletingPurchaseKey(null);
    }
  };

  const sparkline = useMemo(() => (
    history ? buildSparklinePoints(history.points) : ""
  ), [history]);

  return (
    <section className="panel content">
      <div className="section-header-inline">
        <div>
          <h2>Collector Overview</h2>
          <p className="muted">Resumen de compras por carta: coste, valor actual y resultado.</p>
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
          <Link className="btn secondary" href="/settings">Ajustes de vista</Link>
          <button className="btn secondary" type="button" onClick={() => void load({ sort, deckId: deckFilter, profitability: profitabilityFilter, priceData: priceDataFilter })} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="buy-opps-toolbar">
        <label className="field">
          <span>Orden</span>
          <select value={sort} onChange={(event) => void onApplyFilters({ sort: event.target.value as CollectorOverviewSort })}>
            <option value="biggest-gain">Mayor ganancia</option>
            <option value="biggest-loss">Mayor perdida</option>
            <option value="total-value">Valor total</option>
            <option value="total-cost">Coste total</option>
            <option value="card-name">Carta A-Z</option>
            <option value="latest-purchase">Ultima compra</option>
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
          <span>Resultado</span>
          <select value={profitabilityFilter} onChange={(event) => void onApplyFilters({ profitability: event.target.value as CollectorOverviewFilters["profitability"] })}>
            <option value="all">Todos</option>
            <option value="profitable">En positivo</option>
            <option value="unprofitable">En negativo</option>
            <option value="flat">Sin cambio</option>
          </select>
        </label>
        <label className="field">
          <span>Datos de precio</span>
          <select value={priceDataFilter} onChange={(event) => void onApplyFilters({ priceData: event.target.value as CollectorOverviewFilters["priceData"] })}>
            <option value="all">Todos</option>
            <option value="limited-or-unavailable">Limitados o sin datos</option>
          </select>
        </label>
      </div>

      {notice && <p className="notice-banner">{notice}</p>}
      {error && <p className="notice-banner error-banner">{error}</p>}
      {preferencesError && <p className="notice-banner error-banner">{preferencesError}</p>}
      {historyError && <p className="notice-banner error-banner">{historyError}</p>}

      {data.items.length === 0 && loading ? (
        <p className="muted">Cargando compras...</p>
      ) : data.items.length === 0 ? (
        <div className="empty-state compact-empty-state">
          <p>No hay compras para los filtros actuales.</p>
        </div>
      ) : (
        <div className="deck-wishlist-list">
          {loading && <p className="muted">Actualizando overview...</p>}
          {data.items.map((item) => {
            const rowKey = item.key;
            const profitClass = valueDeltaClass(item.deltaUsd);
            const isHistoryLoading = historyLoadingKey === rowKey;
            const isPurchaseOpen = activePurchaseKey === rowKey;
            return (
              <article key={rowKey} className="deck-wishlist-row collector-overview-row">
                <div className="deck-wishlist-row-main collector-overview-row-main">
                  <div className="deck-wishlist-heading">
                    <strong>
                      <Link className="inline-link" href={`/cards/${encodeURIComponent(item.resolvedIdentityKey)}`}>
                        {item.cardName}
                      </Link>
                    </strong>
                    <div className="deck-wishlist-badges">
                      <span className={`status-pill ${profitClass === "positive" ? "status-ok" : profitClass === "negative" ? "status-error" : ""}`}>
                        {profitabilityLabel(item.deltaUsd)}
                      </span>
                      {(item.priceDataStatus !== "available" || item.confidence === "limited") && (
                        <span className="status-pill">Datos parciales</span>
                      )}
                    </div>
                  </div>
                  <div className="deck-wishlist-meta-row collector-overview-meta-row">
                    <span className="muted">
                      Decks: {" "}
                      {item.decks.map((deck, index) => (
                        <span key={deck.id}>
                          {index > 0 ? ", " : ""}
                          <Link className="inline-link" href={`/decks/${deck.id}`}>{deck.name}</Link>
                        </span>
                      ))}
                    </span>
                    <span className="muted">Historial: {historyStatusLabel(item.priceDataStatus)}</span>
                    <span className="muted">Ultima compra: {formatDateTime(item.latestPurchaseAt)}</span>
                    {showPriceFreshness && <span className="muted">Ultimo precio: {item.lastPriceCapturedAt ? formatDateTime(item.lastPriceCapturedAt) : "sin registro"}</span>}
                    {showPriceFreshness && <span className="muted">Precio: {freshnessLabel(item.lastPriceCapturedAt)}</span>}
                    {showPriceFreshness && isLikelyStale(item.lastPriceCapturedAt) && <span className="status-pill">Actualizacion antigua</span>}
                  </div>
                  <div className="deck-wishlist-metrics collector-overview-metrics">
                    <span>Valor actual: <strong>{formatDisplayCurrency(item.currentTotalValueUsd, displayCurrency, "USD")}</strong></span>
                    <span>Coste total: <strong>{formatDisplayCurrency(item.totalCostUsd, displayCurrency, "USD")}</strong></span>
                    <span className={`deck-wishlist-delta collector-overview-delta ${profitClass}`}>
                      Resultado: <strong>{item.deltaUsd == null ? "Sin comparativa fiable" : `${formatDisplayCurrency(item.deltaUsd, displayCurrency, "USD")} (${formatPercent(item.deltaPercent)})`}</strong>
                    </span>
                    <span>Cantidad: <strong>{item.totalPurchasedQuantity}</strong></span>
                    <span>Coste medio: <strong>{formatDisplayCurrency(item.averageCostBasisUsd, displayCurrency, "USD")}</strong></span>
                    <span>Precio actual: <strong>{formatDisplayCurrency(item.currentUnitPriceUsd, displayCurrency, "USD")}</strong></span>
                  </div>
                </div>

                <div className="deck-wishlist-actions">
                  <button className="btn secondary" type="button" onClick={() => void onOpenHistory(item.primaryDeckId, item.primaryWishlistItemId, rowKey)} disabled={isHistoryLoading || item.primaryDeckId <= 0}>
                    {isHistoryLoading ? "Cargando historial..." : "Historial"}
                  </button>
                  <button className="btn secondary" type="button" onClick={() => onTogglePurchase(rowKey)} disabled={item.primaryDeckId <= 0 || purchaseSaving}>
                    {isPurchaseOpen ? "Cerrar compra" : "Registrar compra"}
                  </button>
                </div>

                {isPurchaseOpen && (
                  <form className="deck-wishlist-purchase-form" onSubmit={(event) => {
                    event.preventDefault();
                    void onCreatePurchase(item.primaryDeckId, item.primaryWishlistItemId);
                  }}>
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
                    <button className="btn" type="submit" disabled={purchaseSaving}>
                      {purchaseSaving ? "Guardando..." : "Guardar compra"}
                    </button>
                  </form>
                )}

                {item.purchases.length > 0 && (
                  <div className="deck-wishlist-purchase-list">
                    {item.purchases.map((purchase) => {
                      const purchaseKey = `${rowKey}:${purchase.id}`;
                      const deleting = deletingPurchaseKey === purchaseKey;
                      return (
                        <article key={purchase.id} className="deck-wishlist-purchase-row">
                          <div>
                            <strong>{purchase.quantity}x {formatDisplayCurrency(purchase.unitPriceUsd, displayCurrency, "USD")}</strong>
                            <p className="muted">{purchase.deckName} | {formatDateTime(purchase.purchasedAt)}</p>
                          </div>
                          <button className="btn secondary" type="button" onClick={() => void onDeletePurchase(purchase.deckId, purchase.id, purchaseKey)} disabled={deleting}>
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
            {sparkline ? (
              <svg className="wishlist-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline points={sparkline} />
              </svg>
            ) : (
              <p className="muted">{history.status === "unavailable" ? "No hay historial local para esta carta." : "Hay pocos puntos para mostrar tendencia."}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
