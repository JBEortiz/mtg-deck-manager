"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createDeck, fetchDecks } from "@/lib/api";
import { buildDeckListSearchParams, parseDeckListFilters } from "@/lib/deck-browsing";
import type { Deck, DeckListFilters } from "@/lib/types";

type DeckListClientProps = {
  initialDecks: Deck[];
  initialError?: string | null;
  initialFilters: DeckListFilters;
};

function matchesDeck(deck: Deck, query: string, format: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedFormat = format.trim().toLowerCase();

  if (normalizedFormat && !deck.format.toLowerCase().includes(normalizedFormat)) {
    return false;
  }

  if (!normalizedQuery) {
    return true;
  }

  const haystack = [deck.name, deck.commander, deck.format, ...(deck.cardPreview ?? [])].join(" ").toLowerCase();
  return haystack.includes(normalizedQuery);
}

function sortDecks(decks: Deck[], sort: string) {
  const copy = [...decks];

  switch (sort) {
    case "oldest":
      return copy.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    case "name:asc":
      return copy.sort((left, right) => left.name.localeCompare(right.name));
    case "name:desc":
      return copy.sort((left, right) => right.name.localeCompare(left.name));
    case "cards:desc":
      return copy.sort((left, right) => (right.totalCardCount ?? 0) - (left.totalCardCount ?? 0));
    case "cards:asc":
      return copy.sort((left, right) => (left.totalCardCount ?? 0) - (right.totalCardCount ?? 0));
    case "newest":
    default:
      return copy.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium"
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operacion.";
}

export default function DeckListClient({ initialDecks, initialError = null, initialFilters }: DeckListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [decks, setDecks] = useState(initialDecks);
  const [query, setQuery] = useState(initialFilters.query);
  const [format, setFormat] = useState(initialFilters.format);
  const [sort, setSort] = useState(initialFilters.sort);
  const [name, setName] = useState("");
  const [deckFormat, setDeckFormat] = useState("Commander");
  const [commander, setCommander] = useState("");
  const [savingDeck, setSavingDeck] = useState(false);
  const [createDeckError, setCreateDeckError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState(initialError ?? "");

  useEffect(() => {
    setDecks(initialDecks);
  }, [initialDecks]);

  useEffect(() => {
    const nextFilters = parseDeckListFilters(searchParams);
    setQuery(nextFilters.query);
    setFormat(nextFilters.format);
    setSort(nextFilters.sort);
  }, [searchParams]);

  const filteredDecks = useMemo(() => {
    return sortDecks(decks.filter((deck) => matchesDeck(deck, query, format)), sort);
  }, [decks, format, query, sort]);

  const featuredDeck = filteredDecks[0] ?? decks[0] ?? null;

  const applyFilters = (filters: DeckListFilters) => {
    const params = buildDeckListSearchParams(filters);
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => router.replace(href));
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyFilters({ query, format, sort });
  };

  const onReset = () => {
    setQuery("");
    setFormat("");
    setSort("newest");
    applyFilters({ query: "", format: "", sort: "newest" });
  };

  const refreshDecks = async () => {
    const nextDecks = await fetchDecks();
    setDecks(nextDecks);
    setRefreshError("");
    return nextDecks;
  };

  const onCreateDeck = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    setCreateDeckError("");
    setSavingDeck(true);

    try {
      const createdDeck = await createDeck({
        name,
        format: deckFormat,
        commander
      });

      await refreshDecks();
      setName("");
      setDeckFormat("Commander");
      setCommander("");
      setNotice(`Deck "${createdDeck.name}" creado correctamente.`);
      router.push(`/decks/${createdDeck.id}`);
    } catch (error) {
      setCreateDeckError(getErrorMessage(error));
    } finally {
      setSavingDeck(false);
    }
  };

  return (
    <div className="layout">
      <aside className="panel sidebar">
        <div className="section-header">
          <h2>Decks</h2>
          <p className="muted">Crea un deck nuevo y navega por los ya registrados sin salir de la app principal.</p>
        </div>

        <form className="form compact" onSubmit={onCreateDeck}>
          <label className="field">
            <span>Nombre</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Mi deck Jeskai" required />
          </label>
          <label className="field">
            <span>Formato</span>
            <input value={deckFormat} onChange={(event) => setDeckFormat(event.target.value)} placeholder="Commander" required />
          </label>
          <label className="field">
            <span>Comandante</span>
            <input value={commander} onChange={(event) => setCommander(event.target.value)} placeholder="Mizzix of the Izmagnus" />
          </label>
          <button className="btn" type="submit" disabled={savingDeck}>
            {savingDeck ? "Creando deck..." : "Crear deck"}
          </button>
        </form>

        {createDeckError && <p className="error">{createDeckError}</p>}
        {notice && <p className="notice-banner">{notice}</p>}

        <div className="subsection">
          <form className="form compact" onSubmit={onSubmit}>
            <label className="field">
              <span>Buscar</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Deck, comandante o carta" />
            </label>
            <label className="field">
              <span>Formato</span>
              <input value={format} onChange={(event) => setFormat(event.target.value)} placeholder="Commander" />
            </label>
            <label className="field">
              <span>Orden</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="newest">Mas recientes</option>
                <option value="oldest">Mas antiguos</option>
                <option value="name:asc">Nombre A-Z</option>
                <option value="name:desc">Nombre Z-A</option>
                <option value="cards:desc">Mas cartas</option>
                <option value="cards:asc">Menos cartas</option>
              </select>
            </label>
            <div className="button-row">
              <button className="btn" type="submit">Aplicar</button>
              <button className="btn secondary" type="button" onClick={onReset}>Limpiar</button>
            </div>
          </form>
        </div>

        {refreshError ? (
          <p className="error">{refreshError}</p>
        ) : (
          <p className="muted">Mostrando {filteredDecks.length} deck{filteredDecks.length === 1 ? "" : "s"}.</p>
        )}

        {filteredDecks.length === 0 ? (
          <p className="muted">No hay decks que coincidan con los filtros actuales.</p>
        ) : (
          <ul className="deck-menu">
            {filteredDecks.map((deck) => (
              <li key={deck.id}>
                <Link className={`deck-menu-item${featuredDeck?.id === deck.id ? " active" : ""}`} href={`/decks/${deck.id}`}>
                  <div className="deck-cover-wrap">
                    {deck.deckCoverUrl ? (
                      <img className="deck-cover-image" src={deck.deckCoverUrl} alt={deck.name} loading="lazy" />
                    ) : (
                      <div className="deck-cover-placeholder">Sin imagen</div>
                    )}
                  </div>
                  <strong>{deck.name}</strong>
                  <span className="deck-menu-meta">{deck.format} | {deck.commander || "Sin comandante"}</span>
                  <span className="deck-menu-count">Cartas: {deck.totalCardCount ?? 0}</span>
                  {deck.cardPreview && deck.cardPreview.length > 0 ? (
                    <span className="deck-menu-preview">{deck.cardPreview.join(" | ")}</span>
                  ) : (
                    <span className="deck-menu-preview muted">Todavia sin cartas.</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="panel content">
        <div className="section-header-inline">
          <div>
            <h2>Navegacion de decks</h2>
            <p className="muted">La lista lateral vuelve a ser el punto principal para crear, revisar y abrir decks.</p>
          </div>
          <button className="btn secondary" type="button" onClick={() => void refreshDecks()}>Recargar lista</button>
        </div>

        {!featuredDeck ? (
          <div className="empty-state">
            <h3>Empieza creando tu primer deck</h3>
            <p>Cuando registres uno, aqui veras su resumen y un acceso directo al detalle.</p>
          </div>
        ) : (
          <div className="deck-browser-preview">
            <article className="deck-browser-hero">
              <div className="deck-browser-cover">
                {featuredDeck.deckCoverUrl ? (
                  <img className="deck-header-cover" src={featuredDeck.deckCoverUrl} alt={featuredDeck.name} loading="lazy" />
                ) : (
                  <div className="deck-header-cover placeholder">Sin portada</div>
                )}
              </div>
              <div className="deck-browser-copy">
                <p className="eyebrow">Deck destacado</p>
                <h3>{featuredDeck.name}</h3>
                <p className="muted">
                  {featuredDeck.format} | {featuredDeck.commander || "Sin comandante"} | {featuredDeck.totalCardCount ?? 0} cartas
                </p>
                <p className="muted">Creado el {formatDate(featuredDeck.createdAt)}</p>
                <div className="button-row deck-browser-action-row">
                  <Link className="btn compact" href={`/decks/${featuredDeck.id}`}>Abrir deck</Link>
                  <Link className="btn subtle compact" href="/assistant">Abrir asistente</Link>
                </div>
              </div>
            </article>

            <div className="dashboard-deck-list compact">
              {filteredDecks.slice(0, 6).map((deck) => (
                <Link key={deck.id} className="dashboard-deck-card" href={`/decks/${deck.id}`}>
                  <div className="dashboard-deck-copy">
                    <strong>{deck.name}</strong>
                    <span>{deck.format}</span>
                    <span>{deck.commander || "Sin comandante"}</span>
                    <span>{deck.totalCardCount ?? 0} cartas</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
