"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createDeckPurchase, deleteDeckPurchase, fetchCardDetail } from "@/lib/api";
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
import type { CardDetail, UserPricingPreferences } from "@/lib/types";

type CardDetailClientProps = {
  identity: string;
  initialData: CardDetail | null;
  initialError: string;
  initialPreferences?: Partial<UserPricingPreferences>;
};

function resolveErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la accion.";
}

export default function CardDetailClient({
  identity,
  initialData,
  initialError,
  initialPreferences
}: CardDetailClientProps) {
  const {
    preferences,
    error: preferencesError,
    setPreferredDisplayCurrency
  } = useUserPricingPreferences({
    preferredDisplayCurrency: "USD",
    showPriceFreshness: true,
    ...initialPreferences
  });

  const [data, setData] = useState<CardDetail | null>(initialData);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [deletingPurchaseKey, setDeletingPurchaseKey] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(initialData?.decks[0]?.deckId ?? null);
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [purchasePriceUsd, setPurchasePriceUsd] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));

  const displayCurrency = preferences.preferredDisplayCurrency;
  const showPriceFreshness = preferences.showPriceFreshness;

  const selectedDeck = useMemo(() => {
    if (!data || selectedDeckId == null) {
      return null;
    }
    return data.decks.find((entry) => entry.deckId === selectedDeckId) ?? null;
  }, [data, selectedDeckId]);

  const sparklinePoints = useMemo(() => {
    if (!data) {
      return "";
    }
    return buildSparklinePoints(data.history);
  }, [data]);

  const onRefresh = async () => {
    setLoading(true);
    setError("");
    try {
      const refreshed = await fetchCardDetail(identity);
      setData(refreshed);
      setNotice("Datos actualizados.");
    } catch (refreshError) {
      setError(resolveErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  };

  const onCreatePurchase = async () => {
    if (!data || !selectedDeck) {
      setError("Selecciona un deck valido para registrar la compra.");
      return;
    }

    const validation = validateWishlistPurchaseInput(purchaseQuantity, purchasePriceUsd, purchaseDate);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setPurchaseSaving(true);
    setError("");
    setNotice("");
    try {
      await createDeckPurchase(selectedDeck.deckId, {
        wishlistItemId: selectedDeck.wishlistItemId ?? undefined,
        cardName: data.cardName,
        scryfallId: data.scryfallId,
        quantity: validation.quantity,
        unitPriceUsd: validation.unitPriceUsd,
        purchasedAt: purchaseDate
      });
      const refreshed = await fetchCardDetail(identity);
      setData(refreshed);
      setNotice("Compra registrada.");
      setPurchaseQuantity(1);
      setPurchasePriceUsd("");
    } catch (saveError) {
      setError(resolveErrorMessage(saveError));
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
      const refreshed = await fetchCardDetail(identity);
      setData(refreshed);
      setNotice("Compra eliminada.");
    } catch (removeError) {
      setError(resolveErrorMessage(removeError));
    } finally {
      setDeletingPurchaseKey(null);
    }
  };

  if (!data) {
    return (
      <section className="panel content">
        <div className="section-header-inline">
          <div>
            <h2>Card Detail</h2>
            <p className="muted">No se pudo cargar la carta solicitada.</p>
          </div>
          <button className="btn secondary" type="button" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? "Actualizando..." : "Reintentar"}
          </button>
        </div>
        {error && <p className="notice-banner error-banner">{error}</p>}
      </section>
    );
  }

  const deltaClass = valueDeltaClass(data.pricing.deltaPercent);
  const costDeltaClass = valueDeltaClass(data.costBasis.deltaPercent);
  const signalClass = buySignalClass(data.pricing.signal);

  return (
    <section className="panel content">
      <div className="section-header-inline">
        <div>
          <p className="eyebrow">Card Hub</p>
          <h2>{data.cardName}</h2>
          <p className="muted">Vista global de precio, historial, uso en decks, wishlist y compras.</p>
          <p className="muted">Identidad: <code>{data.identity}</code>{data.scryfallId ? ` | Scryfall ID: ${data.scryfallId}` : ""}</p>
          {showPriceFreshness && <p className="muted">Actualizado: {formatDateTime(data.generatedAt)}</p>}
        </div>
        <div className="deck-wishlist-toolbar">
          <label className="field deck-wishlist-sort-field">
            <span>Moneda</span>
            <select value={displayCurrency} onChange={(event) => void setPreferredDisplayCurrency(event.target.value === "EUR" ? "EUR" : "USD")}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <button className="btn secondary" type="button" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="deck-wishlist-meta-row">
        <span className={`status-pill wishlist-signal-pill ${signalClass}`}>{buySignalLabel(data.pricing.signal)}</span>
        <span className="status-pill">{historyStatusLabel(data.pricing.historyStatus)}</span>
        <span className="muted">{data.pricing.coverageReason}</span>
        {data.pricing.confidence === "limited" && <span className="status-pill">Datos parciales</span>}
        {showPriceFreshness && <span className="muted">Estado: {freshnessLabel(data.pricing.lastCapturedAt)}</span>}
        {showPriceFreshness && isLikelyStale(data.pricing.lastCapturedAt) && <span className="status-pill">Actualizacion antigua</span>}
      </div>

      <div className="deck-wishlist-metrics collector-overview-metrics">
        <span>Actual: <strong>{formatDisplayCurrency(data.pricing.currentPriceUsd, displayCurrency, "USD")}</strong></span>
        <span>Referencia: <strong>{data.pricing.referencePriceUsd == null ? (data.pricing.comparisonReason ?? "Sin base comparable") : formatDisplayCurrency(data.pricing.referencePriceUsd, displayCurrency, "USD")}</strong></span>
        <span className={`deck-wishlist-delta ${deltaClass}`}>Variacion: <strong>{data.pricing.deltaUsd == null ? (data.pricing.comparisonReason ?? "Sin comparativa fiable") : `${formatDisplayCurrency(data.pricing.deltaUsd, displayCurrency, "USD")} (${formatPercent(data.pricing.deltaPercent)})`}</strong></span>
        <span>Comprado: <strong>{data.costBasis.totalPurchasedQuantity}</strong></span>
        <span>Coste medio: <strong>{formatDisplayCurrency(data.costBasis.averageCostBasisUsd, displayCurrency, "USD")}</strong></span>
        <span className={`deck-wishlist-delta ${costDeltaClass}`}>Valor vs coste: <strong>{data.costBasis.deltaUsd == null ? "Sin comparativa fiable" : `${formatDisplayCurrency(data.costBasis.deltaUsd, displayCurrency, "USD")} (${formatPercent(data.costBasis.deltaPercent)})`}</strong></span>
      </div>

      {notice && <p className="notice-banner">{notice}</p>}
      {error && <p className="notice-banner error-banner">{error}</p>}
      {preferencesError && <p className="notice-banner error-banner">{preferencesError}</p>}

      <div className="deck-wishlist-row">
        <div className="section-header-inline">
          <h3>Historial de precio</h3>
          <span className="status-badge">{data.history.length} punto(s)</span>
        </div>
        <p className="muted">{historyStatusDescription(data.pricing.historyStatus)}</p>
        {sparklinePoints ? (
          <svg className="wishlist-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={sparklinePoints} />
          </svg>
        ) : (
          <p className="muted">No hay historial suficiente para mostrar tendencia.</p>
        )}
      </div>

      <div className="deck-wishlist-row">
        <div className="section-header-inline">
          <h3>Uso en decks</h3>
          <span className="status-badge">{data.decks.length}</span>
        </div>
        {data.decks.length === 0 ? (
          <p className="muted">Esta carta no aparece en tus decks.</p>
        ) : (
          <div className="deck-wishlist-purchase-list">
            {data.decks.map((deck) => (
              <article key={deck.deckId} className="deck-wishlist-purchase-row">
                <div>
                  <strong><Link className="inline-link" href={`/decks/${deck.deckId}`}>{deck.deckName}</Link></strong>
                  <p className="muted">
                    {deck.inDeck ? `${deck.quantity} copia(s) en mazo` : "No esta en lista principal"}
                    {deck.wishlistTargetQuantity != null ? ` | Wishlist objetivo ${deck.wishlistTargetQuantity}` : ""}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="deck-wishlist-row">
        <div className="section-header-inline">
          <h3>Wishlist por deck</h3>
          <span className="status-badge">{data.wishlistDecks.length}</span>
        </div>
        {data.wishlistDecks.length === 0 ? (
          <p className="muted">Esta carta no esta en wishlist en tus decks.</p>
        ) : (
          <div className="deck-wishlist-purchase-list">
            {data.wishlistDecks.map((deck) => (
              <article key={deck.deckId} className="deck-wishlist-purchase-row">
                <div>
                  <strong><Link className="inline-link" href={`/decks/${deck.deckId}`}>{deck.deckName}</Link></strong>
                  <p className="muted">
                    Objetivo: {deck.wishlistTargetQuantity ?? 0}
                    {deck.inDeck ? ` | ${deck.quantity} copia(s) en mazo` : " | fuera de la lista principal"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="deck-wishlist-row">
        <div className="section-header-inline">
          <h3>Registrar compra</h3>
        </div>
        <form
          className="deck-wishlist-purchase-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreatePurchase();
          }}
        >
          <label className="field deck-wishlist-purchase-field">
            <span>Deck</span>
            <select
              value={selectedDeckId == null ? "" : String(selectedDeckId)}
              onChange={(event) => setSelectedDeckId(event.target.value ? Number(event.target.value) : null)}
              required
            >
              <option value="" disabled>Selecciona deck</option>
              {data.decks.map((deck) => (
                <option key={deck.deckId} value={deck.deckId}>{deck.deckName}</option>
              ))}
            </select>
          </label>
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
      </div>

      <div className="deck-wishlist-row">
        <div className="section-header-inline">
          <h3>Compras registradas</h3>
          <span className="status-badge">{data.purchases.length}</span>
        </div>
        {data.purchases.length === 0 ? (
          <p className="muted">Aun no hay compras para esta carta.</p>
        ) : (
          <div className="deck-wishlist-purchase-list">
            {data.purchases.map((purchase) => {
              const purchaseKey = `${purchase.deckId}:${purchase.id}`;
              const deleting = deletingPurchaseKey === purchaseKey;
              return (
                <article key={purchase.id} className="deck-wishlist-purchase-row">
                  <div>
                    <strong>{purchase.quantity}x {formatDisplayCurrency(purchase.unitPriceUsd, displayCurrency, "USD")}</strong>
                    <p className="muted">
                      <Link className="inline-link" href={`/decks/${purchase.deckId}`}>{purchase.deckName}</Link> | {formatDateTime(purchase.purchasedAt)}
                    </p>
                  </div>
                  <button className="btn secondary" type="button" onClick={() => void onDeletePurchase(purchase.deckId, purchase.id, purchaseKey)} disabled={deleting}>
                    {deleting ? "Eliminando..." : "Eliminar compra"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
