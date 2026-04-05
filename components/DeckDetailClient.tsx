"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CardThumbnail from "@/components/CardThumbnail";
import DeckCardRow from "@/components/DeckCardRow";
import DeckPassportPanel from "@/components/DeckPassportPanel";
import MulliganCoachPanel from "@/components/MulliganCoachPanel";
import { parseDecklistText } from "@/lib/decklist-import";
import {
  createCard,
  deleteCard,
  fetchDeckCards,
  fetchDecklistExport,
  fetchMulliganSample,
  fetchScryfallAutocomplete,
  fetchScryfallCardByName,
  importDecklist,
  updateCard
} from "@/lib/api";
import { buildCardSearchParams, parseCardFilters } from "@/lib/deck-browsing";
import type { Card, CardFilters, CardLookupResult, Deck, DeckPassport, DeckStats, DeckValueMover, DeckValueTracker, ImportResult, MulliganSample } from "@/lib/types";

type DeckDetailClientProps = {
  initialDeck: Deck;
  initialCards: Card[];
  initialStats: DeckStats;
  initialValueTracker: DeckValueTracker;
  initialValueTrackerError: string;
  initialPassport: DeckPassport | null;
  initialPassportError: string;
  initialMulliganSample: MulliganSample | null;
  initialMulliganError: string;
  initialCardFilters: CardFilters;
};

type ZoomState = {
  alt: string;
  imageUrl: string;
};

type SecondaryTab = "summary" | "passport" | "mulligan";
type DetailMode = "read" | "edit";

function firstThumbnailImage(card: { imageNormal?: string | null; imageSmall?: string | null; imageUrl?: string | null }) {
  return card.imageSmall || card.imageNormal || card.imageUrl || null;
}

function firstPreviewImage(card: { imageNormal?: string | null; imageSmall?: string | null; imageUrl?: string | null }) {
  return card.imageNormal || card.imageUrl || card.imageSmall || null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operacion.";
}

function mapLookupToPayload(card: CardLookupResult, quantity: number) {
  return {
    name: card.name,
    manaValue: card.manaValue,
    type: card.type,
    colors: card.colors || "Colorless",
    quantity,
    scryfallId: card.scryfallId ?? null,
    imageSmall: card.imageSmall ?? null,
    imageNormal: card.imageNormal ?? null,
    imageUrl: card.imageNormal ?? card.imageSmall ?? null
  };
}

function copyTextFallback(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "absolute";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-ES");
}

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

function valueDeltaClass(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "neutral";
  }

  return value > 0 ? "positive" : "negative";
}

function formatColorSummary(passport: DeckPassport | null, stats: DeckStats) {
  if (passport && passport.colors.length > 0) {
    return passport.colors.join(" / ");
  }

  const deckColors = Object.entries(stats.byColor)
    .filter(([color, count]) => color !== "Colorless" && count > 0)
    .map(([color]) => color);

  return deckColors.length > 0 ? deckColors.join(" / ") : "Sin colores definidos";
}

function buildCommanderSummary(passport: DeckPassport | null, stats: DeckStats) {
  if (passport) {
    return {
      plan: passport.gamePlan,
      closing: passport.winPlan,
      early: passport.earlyGamePlan
    };
  }

  return {
    plan: `Deck de ${stats.totalCards} cartas listo para revisar desde la decklist principal.`,
    closing: "Abre el passport si necesitas una lectura mas profunda del plan del deck.",
    early: "La lista de cartas es el foco principal y las herramientas secundarias quedan debajo."
  };
}

const COLOR_LABELS: Record<string, string> = {
  W: "Blanco",
  U: "Azul",
  B: "Negro",
  R: "Rojo",
  G: "Verde",
  Colorless: "Incoloras",
  C: "Incoloras"
};

const TYPE_GROUPS = [
  { label: "Creatures", matchers: ["creature"] },
  { label: "Lands", matchers: ["land"] },
  { label: "Instants", matchers: ["instant"] },
  { label: "Sorceries", matchers: ["sorcery"] },
  { label: "Artifacts", matchers: ["artifact"] },
  { label: "Enchantments", matchers: ["enchantment"] },
  { label: "Planeswalkers", matchers: ["planeswalker"] },
  { label: "Battles", matchers: ["battle"] }
] as const;

function formatCompactColorBreakdown(stats: DeckStats) {
  const entries = Object.entries(stats.byColor)
    .filter(([, count]) => count > 0)
    .map(([color, count]) => `${COLOR_LABELS[color] ?? color}: ${count}`);

  return entries.length > 0 ? entries.join(" · ") : "Sin colores definidos";
}

function summarizeTypes(stats: DeckStats) {
  const totals = TYPE_GROUPS
    .map((group) => {
      const total = Object.entries(stats.byType).reduce((sum, [typeLine, count]) => {
        const normalizedType = typeLine.toLowerCase();
        return group.matchers.some((matcher) => normalizedType.includes(matcher)) ? sum + count : sum;
      }, 0);

      return { label: group.label, total };
    })
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total);

  const detail = Object.entries(stats.byType)
    .sort((left, right) => right[1] - left[1])
    .map(([typeLine, count]) => `${typeLine}: ${count}`);

  return {
    summary: totals.length > 0 ? totals.map((entry) => `${entry.label} ${entry.total}`).join(" · ") : "Sin datos de tipos",
    detail
  };
}

function summarizeCurve(stats: DeckStats) {
  const buckets = { low: 0, mid: 0, high: 0 };

  for (const [manaValue, count] of Object.entries(stats.manaCurve)) {
    const mv = Number.parseInt(manaValue, 10);
    if (Number.isNaN(mv)) {
      continue;
    }

    if (mv <= 2) {
      buckets.low += count;
    } else if (mv <= 4) {
      buckets.mid += count;
    } else {
      buckets.high += count;
    }
  }

  return `0-2: ${buckets.low} · 3-4: ${buckets.mid} · 5+: ${buckets.high}`;
}

function buildImportResultSummary(result: ImportResult) {
  if (result.pipeline.unresolvedLines === 0 && result.pipeline.fallbackImportedCards > 0) {
    if (result.pipeline.metadataPendingCards > 0) {
      return `Se anadieron ${result.importedCount} carta(s). ${result.pipeline.fallbackImportedCards} entraron correctamente con metadatos pendientes por un problema temporal del lookup.`;
    }

    return `Se anadieron ${result.importedCount} carta(s). Las cartas que entraron por fallback ya quedaron enriquecidas correctamente.`;
  }

  if (result.errors.length > 0) {
    return `Se anadieron ${result.importedCount} carta(s). Quedaron ${result.errors.length} linea(s) para revisar.`;
  }

  return `Se anadieron ${result.importedCount} carta(s) correctamente.`;
}

function renderMoverLabel(mover: DeckValueMover, currency: string) {
  return `${formatCurrency(mover.currentTotalValue, currency)} (${mover.deltaValue > 0 ? "+" : ""}${formatCurrency(mover.deltaValue, currency)})`;
}

export default function DeckDetailClient({
  initialDeck,
  initialCards,
  initialStats,
  initialValueTracker,
  initialValueTrackerError,
  initialPassport,
  initialPassportError,
  initialMulliganSample,
  initialMulliganError,
  initialCardFilters
}: DeckDetailClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [cards, setCards] = useState(initialCards);
  const [loadingCards, setLoadingCards] = useState(false);
  const [cardsError, setCardsError] = useState("");
  const [notice, setNotice] = useState("");

  const [nameFilter, setNameFilter] = useState(initialCardFilters.name);
  const [typeFilter, setTypeFilter] = useState(initialCardFilters.type);
  const [colorFilter, setColorFilter] = useState(initialCardFilters.color);
  const [sort, setSort] = useState(initialCardFilters.sort);

  const [detailMode, setDetailMode] = useState<DetailMode>("read");
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab>("summary");

  const [decklistText, setDecklistText] = useState("");
  const [importingDecklist, setImportingDecklist] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showPreviewDetails, setShowPreviewDetails] = useState(false);
  const [showImportDetails, setShowImportDetails] = useState(false);
  const [decklistExporting, setDecklistExporting] = useState(false);
  const [decklistExportError, setDecklistExportError] = useState("");

  const [cardLookupQuery, setCardLookupQuery] = useState("");
  const [cardSuggestions, setCardSuggestions] = useState<string[]>([]);
  const [cardLookupLoading, setCardLookupLoading] = useState(false);
  const [cardLookupError, setCardLookupError] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardLookupResult | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [directAdding, setDirectAdding] = useState(false);
  const autocompleteCacheRef = useRef<Map<string, string[]>>(new Map());
  const cardDetailsCacheRef = useRef<Map<string, CardLookupResult>>(new Map());

  const [mulliganSample, setMulliganSample] = useState<MulliganSample | null>(initialMulliganSample);
  const [mulliganError, setMulliganError] = useState(initialMulliganError);
  const [loadingMulligan, setLoadingMulligan] = useState(false);
  const [quantityUpdatingCardId, setQuantityUpdatingCardId] = useState<number | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<number | null>(null);
  const [zoomedCard, setZoomedCard] = useState<ZoomState | null>(null);
  const [hoveredPreviewCardId, setHoveredPreviewCardId] = useState<number | null>(null);

  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);

  useEffect(() => {
    const nextFilters = parseCardFilters(searchParams);
    setNameFilter(nextFilters.name);
    setTypeFilter(nextFilters.type);
    setColorFilter(nextFilters.color);
    setSort(nextFilters.sort);
  }, [searchParams]);

  useEffect(() => {
    const query = cardLookupQuery.trim();
    if (query.length < 2) {
      setCardSuggestions([]);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setCardLookupError("");
      const cached = autocompleteCacheRef.current.get(query.toLowerCase());
      if (cached) {
        setCardSuggestions(cached);
        return;
      }

      setCardLookupLoading(true);
      try {
        const results = await fetchScryfallAutocomplete(query);
        autocompleteCacheRef.current.set(query.toLowerCase(), results);
        setCardSuggestions(results);
      } catch (error) {
        setCardSuggestions([]);
        setCardLookupError(getErrorMessage(error));
      } finally {
        setCardLookupLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [cardLookupQuery]);

  useEffect(() => {
    if (!zoomedCard) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomedCard(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomedCard]);

  const selectedDeckCoverUrl = useMemo(() => {
    if (initialDeck.deckCoverUrl) {
      return initialDeck.deckCoverUrl;
    }

    const commanderName = initialDeck.commander?.trim().toLowerCase() ?? "";
    if (commanderName) {
      const commanderMatch = cards.find((card) => card.name.trim().toLowerCase() === commanderName);
      const commanderCover = commanderMatch ? firstPreviewImage(commanderMatch) : null;
      if (commanderCover) {
        return commanderCover;
      }
    }

    for (const card of cards) {
      const cover = firstPreviewImage(card);
      if (cover) {
        return cover;
      }
    }

    return null;
  }, [cards, initialDeck.commander, initialDeck.deckCoverUrl]);

  const currentFilters = useMemo<CardFilters>(() => ({
    name: nameFilter,
    type: typeFilter,
    color: colorFilter,
    sort
  }), [colorFilter, nameFilter, sort, typeFilter]);

  const commanderCard = useMemo(() => {
    const commanderName = initialDeck.commander?.trim().toLowerCase() ?? "";
    return commanderName
      ? cards.find((card) => card.name.trim().toLowerCase() === commanderName) ?? null
      : null;
  }, [cards, initialDeck.commander]);

  const totalTrackedCards = useMemo(
    () => cards.reduce((total, card) => total + card.quantity, 0),
    [cards]
  );

  const commanderSummary = useMemo(
    () => buildCommanderSummary(initialPassport, initialStats),
    [initialPassport, initialStats]
  );
  const compactColorSummary = useMemo(() => formatCompactColorBreakdown(initialStats), [initialStats]);
  const compactTypeSummary = useMemo(() => summarizeTypes(initialStats), [initialStats]);
  const compactCurveSummary = useMemo(() => summarizeCurve(initialStats), [initialStats]);

  const decklistPreview = useMemo(() => parseDecklistText(decklistText), [decklistText]);
  const previewRecognizedCardCount = useMemo(
    () => decklistPreview.recognizedEntries.reduce((total, entry) => total + entry.quantity, 0),
    [decklistPreview]
  );
  const hasRecognizedDecklistLines = decklistPreview.recognizedEntries.length > 0;
  const hasUnrecognizedDecklistLines = decklistPreview.unrecognizedLines.length > 0;

  const previewFallbackCard = useMemo(() => {
    const firstWithImage = cards.find((card) => firstPreviewImage(card));
    return commanderCard ?? firstWithImage ?? cards[0] ?? null;
  }, [cards, commanderCard]);

  const hoveredPreviewCard = useMemo(
    () => cards.find((card) => card.id === hoveredPreviewCardId) ?? null,
    [cards, hoveredPreviewCardId]
  );

  const activePreviewCard = hoveredPreviewCard ?? previewFallbackCard;
  const activePreviewImage = activePreviewCard ? firstPreviewImage(activePreviewCard) : null;

  useEffect(() => {
    setImportResult(null);
    setShowImportDetails(false);
  }, [decklistText]);

  useEffect(() => {
    if (hoveredPreviewCardId !== null && !cards.some((card) => card.id === hoveredPreviewCardId)) {
      setHoveredPreviewCardId(null);
    }
  }, [cards, hoveredPreviewCardId]);

  const refreshDeckCards = async (filters: Partial<CardFilters> = currentFilters) => {
    setLoadingCards(true);
    setCardsError("");
    try {
      const nextCards = await fetchDeckCards(initialDeck.id, filters);
      setCards(nextCards);
    } catch (error) {
      setCardsError(getErrorMessage(error));
    } finally {
      setLoadingCards(false);
    }
  };

  const refreshDeckData = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const applyFilters = async (filters: CardFilters) => {
    const params = buildCardSearchParams(filters);
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => router.replace(href));
    await refreshDeckCards(filters);
  };

  const onSubmitFilters = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await applyFilters(currentFilters);
  };

  const onResetFilters = async () => {
    const resetFilters = { name: "", type: "", color: "", sort: "name:asc" };
    setNameFilter("");
    setTypeFilter("");
    setColorFilter("");
    setSort("name:asc");
    await applyFilters(resetFilters);
  };

  const onDrawNewHand = async () => {
    setLoadingMulligan(true);
    setMulliganError("");
    try {
      setMulliganSample(await fetchMulliganSample(initialDeck.id));
    } catch (error) {
      setMulliganError(error instanceof Error ? error.message : "No se pudo generar una nueva mano.");
    } finally {
      setLoadingMulligan(false);
    }
  };

  const getCardLookupDetails = async (name: string): Promise<CardLookupResult> => {
    const key = name.trim().toLowerCase();
    const cached = cardDetailsCacheRef.current.get(key);
    if (cached) {
      return cached;
    }
    const card = await fetchScryfallCardByName(name);
    cardDetailsCacheRef.current.set(key, card);
    return card;
  };

  const clearSelectedCard = () => {
    setSelectedCard(null);
    setSelectedQuantity(1);
    setCardLookupQuery("");
    setCardSuggestions([]);
  };

  const onSelectSuggestion = async (name: string) => {
    setCardLookupError("");
    setNotice("");
    setCardLookupQuery(name);
    setCardSuggestions([]);
    setCardLookupLoading(true);
    try {
      const card = await getCardLookupDetails(name);
      setSelectedCard(card);
      setSelectedQuantity(1);
    } catch (error) {
      setCardLookupError(getErrorMessage(error));
    } finally {
      setCardLookupLoading(false);
    }
  };

  const onAddSelectedDirectly = async () => {
    if (!selectedCard) {
      return;
    }

    setNotice("");
    setCardsError("");
    setDirectAdding(true);
    try {
      await createCard(initialDeck.id, mapLookupToPayload(selectedCard, selectedQuantity));
      await refreshDeckCards();
      refreshDeckData();
      setNotice(`Se ha anadido ${selectedQuantity}x ${selectedCard.name}.`);
      clearSelectedCard();
    } catch (error) {
      setCardsError(getErrorMessage(error));
    } finally {
      setDirectAdding(false);
    }
  };

  const updateCardQuantity = async (card: Card, nextQuantity: number) => {
    if (nextQuantity < 1) {
      return;
    }

    setNotice("");
    setCardsError("");
    setQuantityUpdatingCardId(card.id);
    try {
      await updateCard(initialDeck.id, card.id, {
        name: card.name,
        manaValue: card.manaValue,
        type: card.type,
        colors: card.colors || "Colorless",
        quantity: nextQuantity,
        scryfallId: card.scryfallId ?? null,
        imageSmall: card.imageSmall ?? null,
        imageNormal: card.imageNormal ?? null,
        imageUrl: card.imageNormal ?? card.imageSmall ?? card.imageUrl ?? null
      });
      await refreshDeckCards();
      refreshDeckData();
      setNotice(`Cantidad actualizada para ${card.name}.`);
    } catch (error) {
      setCardsError(getErrorMessage(error));
    } finally {
      setQuantityUpdatingCardId(null);
    }
  };

  const onDeleteCard = async (card: Card) => {
    setNotice("");
    setCardsError("");
    setDeletingCardId(card.id);
    try {
      await deleteCard(initialDeck.id, card.id);
      await refreshDeckCards();
      refreshDeckData();
      setNotice(`Se ha eliminado ${card.name} del deck.`);
    } catch (error) {
      setCardsError(getErrorMessage(error));
    } finally {
      setDeletingCardId(null);
    }
  };

  const onImportDecklist = async () => {
    if (decklistPreview.recognizedEntries.length === 0) {
      return;
    }

    setNotice("");
    setImportError("");
    setCardsError("");
    setImportingDecklist(true);
    setDecklistExportError("");
    try {
      const result = await importDecklist(initialDeck.id, decklistText);
      setImportResult(result);
      setShowPreviewDetails(false);
      setShowImportDetails(false);
      await refreshDeckCards();
      refreshDeckData();
      const issueText = result.errors.length > 0 ? ` con ${result.errors.length} incidencia(s)` : "";
      setNotice(`Importadas ${result.importedCount} carta(s)${issueText}.`);
      if (result.errors.length === 0) {
        setDecklistText("");
      }
    } catch (error) {
      setImportResult(null);
      setImportError(getErrorMessage(error));
    } finally {
      setImportingDecklist(false);
    }
  };

  const getDecklistExportText = async (): Promise<string | null> => {
    setDecklistExportError("");
    setDecklistExporting(true);
    try {
      return await fetchDecklistExport(initialDeck.id);
    } catch (error) {
      setDecklistExportError(getErrorMessage(error));
      return null;
    } finally {
      setDecklistExporting(false);
    }
  };

  const onCopyDecklist = async () => {
    const text = await getDecklistExportText();
    if (text === null) {
      return;
    }

    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        copied = true;
      } else {
        copied = copyTextFallback(text);
      }
    } catch {
      copied = copyTextFallback(text);
    }

    if (copied) {
      setNotice("Decklist copiada al portapapeles.");
    } else {
      setDecklistExportError("No se pudo copiar la decklist. Usa Descargar export.");
    }
  };

  const onDownloadDecklist = async () => {
    const text = await getDecklistExportText();
    if (text === null) {
      return;
    }

    const safeName = initialDeck.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const filename = `${safeName || "deck"}-decklist.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setNotice(`Decklist exportada como ${filename}.`);
  };

  const openZoom = (imageUrl: string | null, alt: string) => {
    if (!imageUrl) {
      return;
    }
    setZoomedCard({ imageUrl, alt });
  };

  return (
    <section className="panel content deck-detail-shell deck-page-shell">
      <section className="deck-read-hero">
        <div className="deck-identity-layout">
          <div className="deck-header-with-cover deck-hero-main">
            <div className="deck-header-cover-wrap">
              {selectedDeckCoverUrl ? (
                <button className="cover-button" type="button" onClick={() => openZoom(selectedDeckCoverUrl, `${initialDeck.name} cover`)}>
                  <img className="deck-header-cover" src={selectedDeckCoverUrl} alt={`${initialDeck.name} cover`} loading="lazy" />
                </button>
              ) : (
                <div className="deck-header-cover placeholder">Sin portada</div>
              )}
            </div>
            <div className="deck-detail-summary">
              <p className="eyebrow">Deck</p>
              <h2>{initialDeck.name}</h2>
              <p className="muted">{initialDeck.format}, creado {formatDateTime(initialDeck.createdAt)}</p>
              <div className="deck-hero-chip-row">
                <span className="status-pill">{totalTrackedCards} cartas</span>
                <span className="status-pill">{cards.length} entradas</span>
                <span className="status-pill">Colores: {formatColorSummary(initialPassport, initialStats)}</span>
                <span className="status-pill">Comandante: {initialDeck.commander || "Pendiente"}</span>
              </div>
              <p className="muted">{commanderSummary.plan}</p>
            </div>
          </div>

          <div className="deck-hero-actions">
            <div className="deck-mode-toggle" role="tablist" aria-label="Modo de deck detail">
              <button className={`tab-button${detailMode === "read" ? " active" : ""}`} type="button" onClick={() => setDetailMode("read")}>
                Leer
              </button>
              <button className={`tab-button${detailMode === "edit" ? " active" : ""}`} type="button" onClick={() => setDetailMode("edit")}>
                Editar
              </button>
            </div>
            <div className="button-row deck-hero-button-row">
              <Link className="back-link" href="/decks">← Volver</Link>
              <button className="btn secondary" type="button" onClick={() => void refreshDeckCards()}>
                Recargar
              </button>
              <button className="btn secondary" type="button" onClick={() => void onCopyDecklist()} disabled={decklistExporting}>
                {decklistExporting ? "Preparando..." : "Copiar decklist"}
              </button>
              <button className="btn secondary" type="button" onClick={() => void onDownloadDecklist()} disabled={decklistExporting}>
                {decklistExporting ? "Preparando..." : "Descargar"}
              </button>
            </div>
          </div>
        </div>

        {notice && <p className="notice-banner">{notice}</p>}
        {decklistExportError && <p className="error">{decklistExportError}</p>}
      </section>

      <section className="deck-value-panel">
        <div className="section-header-inline">
          <div>
            <h3>Valor del deck</h3>
            <p className="muted">{initialValueTracker.note}</p>
            {initialValueTrackerError && <p className="muted">{initialValueTrackerError}</p>}
          </div>
          <span className={`status-badge deck-value-status ${initialValueTracker.status}`}>
            {initialValueTracker.status === "ready"
              ? "Actualizado"
              : initialValueTracker.status === "partial"
                ? "Parcial"
                : initialValueTracker.status === "stale"
                  ? "Snapshot previo"
                  : initialValueTracker.status === "empty"
                    ? "Sin cartas"
                    : "Pendiente"}
          </span>
        </div>

        <div className="deck-value-grid">
          <article className="deck-value-card">
            <span className="deck-value-label">Al registrar/importar</span>
            <strong className="deck-value-number">{formatCurrency(initialValueTracker.baselineValue, initialValueTracker.currency)}</strong>
            <p className="deck-value-meta">
              {initialValueTracker.baselineCapturedAt ? `Base: ${formatDateTime(initialValueTracker.baselineCapturedAt)}` : "Base pendiente"}
            </p>
          </article>
          <article className="deck-value-card">
            <span className="deck-value-label">Ahora</span>
            <strong className="deck-value-number">{formatCurrency(initialValueTracker.currentValue, initialValueTracker.currency)}</strong>
            <p className="deck-value-meta">
              {initialValueTracker.lastUpdated ? `Actualizado: ${formatDateTime(initialValueTracker.lastUpdated)}` : "Sin snapshot actual"}
            </p>
          </article>
          <article className={`deck-value-card deck-value-delta ${valueDeltaClass(initialValueTracker.deltaValue)}`}>
            <span className="deck-value-label">Cambio</span>
            <strong className="deck-value-number">{formatCurrency(initialValueTracker.deltaValue, initialValueTracker.currency)}</strong>
            <p className="deck-value-meta">{formatPercent(initialValueTracker.deltaPercent)}</p>
          </article>
          <article className="deck-value-card">
            <span className="deck-value-label">Cobertura</span>
            <strong className="deck-value-number">{initialValueTracker.pricedCardCount}</strong>
            <p className="deck-value-meta">
              {initialValueTracker.missingPriceCardCount > 0
                ? `${initialValueTracker.missingPriceCardCount} carta(s) siguen sin precio`
                : "Todas las entradas tienen precio"}
            </p>
          </article>
        </div>

        <div className="deck-value-movers">
          <section className="deck-movers-column">
            <div className="section-header-inline">
              <h4>Risers</h4>
              <span className="status-badge">{initialValueTracker.topRisers.length}</span>
            </div>
            {initialValueTracker.topRisers.length === 0 ? (
              <p className="muted">Sin subidas claras todavia.</p>
            ) : (
              <div className="deck-mover-list">
                {initialValueTracker.topRisers.map((mover) => (
                  <article key={mover.key} className="deck-mover-row">
                    <div className="deck-mover-copy">
                      <strong>{mover.cardName}</strong>
                      <p className="muted">{mover.quantity} copia(s) · {renderMoverLabel(mover, initialValueTracker.currency)}</p>
                    </div>
                    <span className="status-pill status-ok">{formatPercent(mover.deltaPercent) === "Pendiente" ? "Nuevo" : formatPercent(mover.deltaPercent)}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="deck-movers-column">
            <div className="section-header-inline">
              <h4>Fallers</h4>
              <span className="status-badge">{initialValueTracker.topFallers.length}</span>
            </div>
            {initialValueTracker.topFallers.length === 0 ? (
              <p className="muted">Sin bajadas claras todavia.</p>
            ) : (
              <div className="deck-mover-list">
                {initialValueTracker.topFallers.map((mover) => (
                  <article key={mover.key} className="deck-mover-row">
                    <div className="deck-mover-copy">
                      <strong>{mover.cardName}</strong>
                      <p className="muted">{mover.quantity} copia(s) · {renderMoverLabel(mover, initialValueTracker.currency)}</p>
                    </div>
                    <span className="status-pill status-error">{formatPercent(mover.deltaPercent) === "Pendiente" ? "Sin base" : formatPercent(mover.deltaPercent)}</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="deck-main-shell">
        <section className="deck-builder-panel decklist-panel">
          <div className="section-header-inline decklist-panel-header">
            <div>
              <h3>Decklist</h3>
              <p className="muted">
                {detailMode === "read"
                  ? "Modo lectura activo. Recorre la lista, usa hover para previsualizar y toca una carta para ampliarla."
                  : "Modo edicion activo. Anade cartas arriba y ajusta o elimina entradas directamente desde la lista."}
              </p>
            </div>
            <span className="status-badge">{detailMode === "read" ? "Lectura" : "Edicion"}</span>
          </div>

          <form onSubmit={onSubmitFilters} className="deck-filter-bar compact-filter-bar">
            <label className="field"><span>Buscar</span><input value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Nombre parcial" /></label>
            <label className="field"><span>Tipo</span><input value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} placeholder="Tipo exacto" /></label>
            <label className="field"><span>Color</span><input value={colorFilter} onChange={(event) => setColorFilter(event.target.value)} placeholder="Color exacto" /></label>
            <label className="field">
              <span>Orden</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="name:asc">Nombre A-Z</option>
                <option value="name:desc">Nombre Z-A</option>
                <option value="manaValue:asc">Valor de mana ascendente</option>
                <option value="manaValue:desc">Valor de mana descendente</option>
              </select>
            </label>
            <div className="button-row">
              <button className="btn" type="submit">Aplicar</button>
              <button className="btn secondary" type="button" onClick={() => void onResetFilters()}>Limpiar</button>
            </div>
          </form>

          {detailMode === "edit" && (
            <div className="deck-edit-stack">
              <section className="deck-edit-panel">
                <div className="section-header-inline">
                  <div>
                    <h4>Anadir cartas</h4>
                    <p className="muted">Busca una carta para anadirla rapido o pega varias lineas para importar varias a la vez.</p>
                  </div>
                  <span className="status-badge">{previewRecognizedCardCount} listas</span>
                </div>

                <div className="deck-edit-tools">
                  <div className="deck-builder-search">
                    <label className="field">
                      <span>Buscar carta</span>
                      <input
                        value={cardLookupQuery}
                        onChange={(event) => setCardLookupQuery(event.target.value)}
                        placeholder="Empieza a escribir el nombre"
                      />
                    </label>
                    {cardLookupLoading && <p className="muted">Buscando sugerencias...</p>}
                    {cardLookupError && <p className="error">{cardLookupError}</p>}
                    {cardSuggestions.length > 0 && (
                      <ul className="lookup-results">
                        {cardSuggestions.map((name) => (
                          <li key={name}>
                            <button className="lookup-result-btn" type="button" onClick={() => void onSelectSuggestion(name)}>
                              <strong>{name}</strong>
                              <span>Seleccionar para anadir</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {selectedCard ? (
                      <div className="selected-card-panel deck-edit-selected">
                        <div className="selected-card-layout">
                          <CardThumbnail imageUrl={firstThumbnailImage(selectedCard)} alt={selectedCard.name} size="md" onClick={() => openZoom(firstPreviewImage(selectedCard), selectedCard.name)} />
                          <div className="selected-card-copy">
                            <div className="card-title-row">
                              <strong className="card-name">{selectedCard.name}</strong>
                              <span className="card-mv">MV {selectedCard.manaValue}</span>
                            </div>
                            <p className="card-type">{selectedCard.type}</p>
                            <p className="muted">Colores: {selectedCard.colors || "Incolora"}</p>
                            <div className="selected-card-actions">
                              <label className="field quantity-field">
                                <span>Cantidad</span>
                                <input type="number" value={selectedQuantity} onChange={(event) => setSelectedQuantity(Number(event.target.value) || 1)} min={1} />
                              </label>
                              <div className="button-row">
                                <button className="btn" type="button" onClick={() => void onAddSelectedDirectly()} disabled={directAdding}>
                                  {directAdding ? "Anadiendo..." : "Anadir al deck"}
                                </button>
                                <button className="btn secondary" type="button" onClick={clearSelectedCard}>Limpiar</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state compact-empty-state">
                        <p>Selecciona una carta para anadirla sin salir del deck.</p>
                      </div>
                    )}
                  </div>

                  <div className="deck-builder-search">
                    <label className="field">
                      <span>Anadir varias cartas</span>
                      <textarea
                        value={decklistText}
                        onChange={(event) => setDecklistText(event.target.value)}
                        placeholder={"1 Sol Ring\n1 Arcane Signet\n1 Swords to Plowshares"}
                        rows={6}
                      />
                    </label>
                    <div className="button-row">
                      <button className="btn" type="button" onClick={() => void onImportDecklist()} disabled={importingDecklist || !hasRecognizedDecklistLines}>
                        {importingDecklist ? "Importando..." : `Anadir ${previewRecognizedCardCount || 0} carta(s)`}
                      </button>
                      <button className="btn secondary" type="button" onClick={() => setDecklistText("")} disabled={importingDecklist || decklistText.trim().length === 0}>
                        Limpiar
                      </button>
                    </div>
                    {importError && <p className="error">{importError}</p>}

                    {decklistPreview.totalPastedLines > 0 && (
                      <section className="result-box import-summary-box compact-import-result">
                        <div className="section-header-inline">
                          <div>
                            <h5>Vista previa</h5>
                            <p className="muted">
                              {hasRecognizedDecklistLines
                                ? `Hay ${previewRecognizedCardCount} carta(s) listas desde ${decklistPreview.detectedSourceLabel}.`
                                : "Todavia no hay cartas listas para anadir."}
                            </p>
                          </div>
                          <button className="btn secondary" type="button" onClick={() => setShowPreviewDetails((current) => !current)}>
                            {showPreviewDetails ? "Ocultar" : "Ver detalle"}
                          </button>
                        </div>
                        <div className="import-metric-list compact-metric-list">
                          <span className="status-pill">{decklistPreview.detectedSourceLabel}</span>
                          <span className="status-pill status-ok">Listas: {previewRecognizedCardCount}</span>
                          {decklistPreview.duplicatesConsolidated > 0 && <span className="status-pill">Consolidadas: {decklistPreview.duplicatesConsolidated}</span>}
                          {(decklistPreview.ignoredBlankLines + decklistPreview.ignoredSectionLines) > 0 && (
                            <span className="status-pill">Ignoradas: {decklistPreview.ignoredBlankLines + decklistPreview.ignoredSectionLines}</span>
                          )}
                          {hasUnrecognizedDecklistLines && <span className="status-pill status-error">Pendientes: {decklistPreview.unrecognizedLines.length}</span>}
                        </div>

                        {showPreviewDetails && (
                          <div className="stack-list">
                            {hasRecognizedDecklistLines && (
                              <section className="preview-box">
                                <div className="section-header-inline">
                                  <h5>Cartas detectadas</h5>
                                  <span className="status-badge">{decklistPreview.recognizedEntries.length}</span>
                                </div>
                                <div className="stack-list compact-preview-list">
                                  {decklistPreview.recognizedEntries.slice(0, 10).map((entry) => (
                                    <article key={entry.key} className="preview-row">
                                      <div className="preview-row-main">
                                        <strong>{entry.quantity}x {entry.name}</strong>
                                        <p className="muted">Lineas: {entry.lineNumbers.join(", ")}</p>
                                      </div>
                                    </article>
                                  ))}
                                  {decklistPreview.recognizedEntries.length > 10 && (
                                    <p className="muted">Y {decklistPreview.recognizedEntries.length - 10} entrada(s) mas listas para anadir.</p>
                                  )}
                                </div>
                              </section>
                            )}

                            {hasUnrecognizedDecklistLines && (
                              <section className="preview-box">
                                <div className="section-header-inline">
                                  <h5>Lineas pendientes</h5>
                                  <span className="status-badge status-error">{decklistPreview.unrecognizedLines.length}</span>
                                </div>
                                <div className="stack-list compact-preview-list">
                                  {decklistPreview.unrecognizedLines.map((entry, index) => (
                                    <article key={`${entry.line}-${index}`} className="preview-row preview-row-error">
                                      <div className="preview-row-main">
                                        <strong>Linea {entry.line}</strong>
                                        <p>{entry.rawLine || "(vacia)"}</p>
                                        <p className="muted">{entry.message}</p>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </section>
                            )}
                          </div>
                        )}
                      </section>
                    )}

                    {importResult && (
                      <div className="result-box import-result-box compact-import-result">
                        <div className="section-header-inline">
                          <div>
                            <h5>Resultado</h5>
                            <p className="muted">{buildImportResultSummary(importResult)}</p>
                            <p className="muted">{importResult.pipeline.commanderDetection}</p>
                            {importResult.pipeline.metadataEnrichedCards > 0 && (
                              <p className="muted">
                                Se recuperaron metadatos pendientes en {importResult.pipeline.metadataEnrichedCards} carta(s) importadas anteriormente.
                              </p>
                            )}
                            {importResult.pipeline.metadataPendingCards > 0 && (
                              <p className="muted">
                                Quedan {importResult.pipeline.metadataPendingCards} carta(s) pendientes de enriquecimiento cuando el lookup vuelva a responder.
                              </p>
                            )}
                          </div>
                          <button className="btn secondary" type="button" onClick={() => setShowImportDetails((current) => !current)}>
                            {showImportDetails ? "Ocultar" : "Ver detalle"}
                          </button>
                        </div>
                        <div className="import-metric-list compact-metric-list">
                          <span className="status-pill">{importResult.pipeline.detectedSource}</span>
                          <span className="status-pill status-ok">Importadas: {importResult.pipeline.actuallyImportedCards}</span>
                          <span className="status-pill">Movimientos: {importResult.createdCards.length + importResult.updatedCards.length}</span>
                          {importResult.pipeline.parseFailures > 0 && <span className="status-pill status-error">Parseo: {importResult.pipeline.parseFailures}</span>}
                          {importResult.pipeline.unresolvedCardLookups > 0 && <span className="status-pill status-error">Lookup: {importResult.pipeline.unresolvedCardLookups}</span>}
                          {importResult.pipeline.normalizedExactLookups > 0 && <span className="status-pill">Normalizadas: {importResult.pipeline.normalizedExactLookups}</span>}
                          {importResult.pipeline.fuzzyLookups > 0 && <span className="status-pill">Fuzzy: {importResult.pipeline.fuzzyLookups}</span>}
                          {importResult.pipeline.fallbackImportedCards > 0 && <span className="status-pill status-ok">Fallback ok: {importResult.pipeline.fallbackImportedCards}</span>}
                          {importResult.pipeline.metadataEnrichedCards > 0 && <span className="status-pill">Metadatos: {importResult.pipeline.metadataEnrichedCards}</span>}
                          {importResult.pipeline.metadataPendingCards > 0 && <span className="status-pill">Pend. metadatos: {importResult.pipeline.metadataPendingCards}</span>}
                          {importResult.pipeline.ignoredLines > 0 && <span className="status-pill">Ignoradas: {importResult.pipeline.ignoredLines}</span>}
                          {importResult.pipeline.unresolvedLines > 0 && <span className="status-pill status-error">Pendientes: {importResult.pipeline.unresolvedLines}</span>}
                        </div>

                        {showImportDetails && (
                          <div className="stack-list">
                            {(importResult.createdCards.length > 0 || importResult.updatedCards.length > 0) && (
                              <section className="preview-box">
                                <div className="section-header-inline">
                                  <h5>Cambios aplicados</h5>
                                  <span className="status-badge">{importResult.createdCards.length + importResult.updatedCards.length}</span>
                                </div>
                                <div className="stack-list compact-preview-list">
                                  {importResult.createdCards.map((card) => (
                                    <article key={`created-${card.id}`} className="preview-row">
                                      <div className="preview-row-main">
                                        <strong>{card.quantity}x {card.name}</strong>
                                        <p className="muted">Nueva entrada en la decklist</p>
                                      </div>
                                    </article>
                                  ))}
                                  {importResult.updatedCards.map((card) => (
                                    <article key={`updated-${card.id}`} className="preview-row">
                                      <div className="preview-row-main">
                                        <strong>{card.name}</strong>
                                        <p className="muted">Cantidad final: {card.quantity}</p>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </section>
                            )}

                            {importResult.errors.length > 0 && (
                              <section className="preview-box">
                                <div className="section-header-inline">
                                  <h5>Lo que falta revisar</h5>
                                  <span className="status-badge status-error">{importResult.errors.length}</span>
                                </div>
                                <div className="stack-list compact-preview-list">
                                  {importResult.errors.map((error, index) => (
                                    <article key={`${error.line}-${index}`} className="preview-row preview-row-error">
                                      <div className="preview-row-main">
                                        <strong>Linea {error.line}{error.kind === "lookup" ? " · Lookup" : error.kind === "parse" ? " · Parseo" : ""}</strong>
                                        <p>{error.rawLine || "(vacia)"}</p>
                                        <p className="muted">{error.message}</p>
                                        {typeof error.lookupStatus === "number" && (
                                          <p className="muted">Estado: {error.lookupStatus}{error.lookupCode ? ` · ${error.lookupCode}` : ""}</p>
                                        )}
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </section>
                            )}

                            {Object.keys(importResult.pipeline.metadataEnrichmentFailuresByReason).length > 0 && (
                              <section className="preview-box">
                                <div className="section-header-inline">
                                  <h5>Enriquecimiento pendiente</h5>
                                  <span className="status-badge">{importResult.pipeline.metadataPendingCards}</span>
                                </div>
                                <div className="stack-list compact-preview-list">
                                  {Object.entries(importResult.pipeline.metadataEnrichmentFailuresByReason).map(([reason, count]) => (
                                    <article key={reason} className="preview-row">
                                      <div className="preview-row-main">
                                        <strong>{reason}</strong>
                                        <p className="muted">{count} carta(s) siguen esperando metadatos.</p>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </section>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {cardsError && <p className="error">{cardsError}</p>}

          {loadingCards ? (
            <p className="muted">Cargando cartas...</p>
          ) : cards.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <p>No hay cartas para los filtros actuales.</p>
            </div>
          ) : detailMode === "read" ? (
            <div className="decklist-read-layout">
              <div className="decklist-column-grid">
                {cards.map((card) => {
                  const cardImage = firstThumbnailImage(card);
                  const previewImage = firstPreviewImage(card);
                  return (
                    <DeckCardRow
                      key={card.id}
                      imageUrl={cardImage}
                      title={card.name}
                      subtitle={card.type}
                      meta={`Colores: ${card.colors || "Incolora"}, MV ${card.manaValue}`}
                      quantity={card.quantity}
                      mode="read"
                      onPreview={() => openZoom(previewImage, card.name)}
                      onHoverPreview={() => setHoveredPreviewCardId(card.id)}
                      onHoverLeave={() => setHoveredPreviewCardId(null)}
                    />
                  );
                })}
              </div>

              <aside className="deck-hover-preview" aria-label="Vista previa de carta">
                <div className="deck-hover-preview-card">
                  {activePreviewImage ? (
                    <img className="deck-hover-preview-image" src={activePreviewImage} alt={activePreviewCard?.name || "Carta"} loading="lazy" />
                  ) : (
                    <div className="deck-hover-preview-image card-preview-thumb-placeholder">Sin imagen</div>
                  )}
                  <div className="deck-hover-preview-copy">
                    <strong>{activePreviewCard?.name || "Selecciona una carta"}</strong>
                    <p className="muted">
                      {activePreviewCard
                        ? `${activePreviewCard.type}, ${activePreviewCard.colors || "Incolora"}, MV ${activePreviewCard.manaValue}`
                        : "Pasa el cursor por una carta para verla aqui."}
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          ) : (
            <div className="decklist-column-grid decklist-column-grid-edit">
              {cards.map((card) => {
                const isUpdatingQuantity = quantityUpdatingCardId === card.id;
                const isDeleting = deletingCardId === card.id;
                const cardImage = firstThumbnailImage(card);
                const previewImage = firstPreviewImage(card);

                return (
                  <DeckCardRow
                    key={card.id}
                    imageUrl={cardImage}
                    title={card.name}
                    subtitle={card.type}
                    meta={`Colores: ${card.colors || "Incolora"}, MV ${card.manaValue}`}
                    quantity={card.quantity}
                    mode="edit"
                    onPreview={() => openZoom(previewImage, card.name)}
                    actions={(
                      <div className="deck-card-edit-actions">
                        <div className="quantity-controls">
                          <button className="btn secondary qty-btn" type="button" onClick={() => void updateCardQuantity(card, card.quantity - 1)} disabled={isUpdatingQuantity || card.quantity <= 1}>-</button>
                          <button className="btn secondary qty-btn" type="button" onClick={() => void updateCardQuantity(card, card.quantity + 1)} disabled={isUpdatingQuantity}>+</button>
                        </div>
                        <button className="btn danger" type="button" onClick={() => void onDeleteCard(card)} disabled={isDeleting}>
                          {isDeleting ? "Eliminando..." : "Eliminar"}
                        </button>
                      </div>
                    )}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="deck-secondary-panel">
          <div className="section-header-inline">
            <div>
              <h3>Analisis y extras</h3>
              <p className="muted">Siguen disponibles, pero quedan en segundo plano respecto a la lectura y edicion de la decklist.</p>
            </div>
          </div>
          <div className="tab-row">
            <button className={`tab-button${secondaryTab === "summary" ? " active" : ""}`} type="button" onClick={() => setSecondaryTab("summary")}>Resumen</button>
            <button className={`tab-button${secondaryTab === "passport" ? " active" : ""}`} type="button" onClick={() => setSecondaryTab("passport")}>Passport</button>
            <button className={`tab-button${secondaryTab === "mulligan" ? " active" : ""}`} type="button" onClick={() => setSecondaryTab("mulligan")}>Mulligan</button>
          </div>

          {secondaryTab === "summary" && (
            <section className="deck-summary-grid">
              <article className="deck-summary-item">
                <span className="deck-summary-label">Total</span>
                <strong className="deck-summary-value">{initialStats.totalCards}</strong>
                <p className="deck-summary-meta">Cartas en la lista</p>
              </article>
              <article className="deck-summary-item">
                <span className="deck-summary-label">Entradas</span>
                <strong className="deck-summary-value">{cards.length}</strong>
                <p className="deck-summary-meta">Filas actuales</p>
              </article>
              <article className="deck-summary-item deck-summary-item-wide">
                <span className="deck-summary-label">Por color</span>
                <p className="deck-summary-text">{compactColorSummary}</p>
              </article>
              <article className="deck-summary-item deck-summary-item-wide">
                <span className="deck-summary-label">Por tipo</span>
                <p className="deck-summary-text">{compactTypeSummary.summary}</p>
                {compactTypeSummary.detail.length > 0 && (
                  <details className="deck-summary-details">
                    <summary>Ver desglose completo</summary>
                    <p className="deck-summary-meta">{compactTypeSummary.detail.join(" · ")}</p>
                  </details>
                )}
              </article>
              <article className="deck-summary-item deck-summary-item-wide">
                <span className="deck-summary-label">Curva</span>
                <p className="deck-summary-text">{compactCurveSummary}</p>
              </article>
              <article className="deck-summary-item deck-summary-item-wide">
                <span className="deck-summary-label">Comandante</span>
                <p className="deck-summary-text">{initialDeck.commander || "Pendiente"}</p>
              </article>
            </section>
          )}

          {secondaryTab === "passport" && (
            <DeckPassportPanel passport={initialPassport} passportError={initialPassportError} selectedDeckCoverUrl={selectedDeckCoverUrl} />
          )}

          {secondaryTab === "mulligan" && (
            <MulliganCoachPanel
              passport={initialPassport}
              passportError={initialPassportError}
              mulliganSample={mulliganSample}
              mulliganError={mulliganError}
              loadingMulligan={loadingMulligan}
              onDrawNewHand={() => void onDrawNewHand()}
            />
          )}
        </section>
      </section>

      {zoomedCard && (
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label={`Vista ampliada de ${zoomedCard.alt}`} onClick={() => setZoomedCard(null)}>
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-inline">
              <strong>{zoomedCard.alt}</strong>
              <button className="btn secondary" type="button" onClick={() => setZoomedCard(null)}>Cerrar</button>
            </div>
            <img className="lightbox-image" src={zoomedCard.imageUrl} alt={zoomedCard.alt} />
          </div>
        </div>
      )}
    </section>
  );
}
