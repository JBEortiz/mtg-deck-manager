import Link from "next/link";
import StatCard from "@/components/StatCard";
import { getCurrentUser } from "@/lib/server/auth";
import { getDecksByOwner } from "@/lib/server/mtg-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default async function HomePage() {
  const currentUser = await getCurrentUser();
  let decks = [] as Awaited<ReturnType<typeof getDecksByOwner>>;
  let backendError = "";

  if (currentUser) {
    try {
      decks = await getDecksByOwner(currentUser.id);
    } catch (error) {
      backendError = error instanceof Error ? error.message : "No se pudieron cargar los decks.";
    }
  }

  const totalDecks = decks.length;
  const totalCards = decks.reduce((sum, deck) => sum + (deck.totalCardCount ?? 0), 0);
  const totalFormats = new Set(decks.map((deck) => deck.format.trim()).filter(Boolean)).size;
  const featuredDecks = decks.slice(0, 3);

  return (
    <div className="page-stack">
      <section className="panel entry-panel">
        <div className="entry-layout">
          <div className="entry-copy">
            <p className="eyebrow">Entrada</p>
            <h2>{currentUser ? "Tu espacio de trabajo" : "Accede para gestionar tus decks"}</h2>
            <p className="muted">
              {currentUser
                ? "Abre tus decks, importa listas y sigue trabajando desde tu cuenta."
                : "Crea una cuenta o inicia sesion para ver y proteger solo tus decks."}
            </p>
          </div>
          <div className="entry-actions">
            {currentUser ? (
              <>
                <Link className="btn" href="/decks">Abrir decks</Link>
                <Link className="btn secondary" href="/assistant">Ir al asistente</Link>
              </>
            ) : (
              <>
                <Link className="btn" href="/sign-up">Crear cuenta</Link>
                <Link className="btn secondary" href="/sign-in">Iniciar sesion</Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="stats-strip">
        <StatCard label="Decks registrados" value={totalDecks} />
        <StatCard label="Cartas guardadas" value={totalCards} />
        <StatCard label="Formatos activos" value={totalFormats || 0} />
      </section>

      {backendError ? (
        <section className="panel">
          <p className="error">{backendError}</p>
        </section>
      ) : null}

      <div className="two-column-grid">
        <section className="panel">
          <div className="section-header">
            <h3>Acciones principales</h3>
          </div>
          <div className="feature-list">
            <article className="feature-item">
              <strong>Crear o abrir un deck</strong>
              <p className="muted">{currentUser ? "Entra a la lista de decks para crear uno nuevo, abrir uno existente y seguir desde su detalle." : "La lista de decks queda protegida por sesion y solo muestra tus datos."}</p>
            </article>
            <article className="feature-item">
              <strong>Importar o ajustar cartas</strong>
              <p className="muted">Pega una decklist para importarla directamente y deja la busqueda individual como ajuste fino.</p>
            </article>
            <article className="feature-item">
              <strong>Consultar asistente</strong>
              <p className="muted">Usa reglas y busqueda de cartas sin salir del producto principal.</p>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="section-header-inline">
            <h3>Decks recientes</h3>
            <Link className="inline-link" href="/decks">Ver todos</Link>
          </div>
          {!currentUser ? (
            <div className="empty-state">
              <h4>Tu lista aparecera al iniciar sesion</h4>
              <p>Los decks recientes se muestran solo dentro de tu cuenta.</p>
            </div>
          ) : featuredDecks.length === 0 ? (
            <div className="empty-state">
              <h4>Sin decks todavia</h4>
              <p>Crea el primer deck para que este panel muestre actividad real.</p>
            </div>
          ) : (
            <div className="dashboard-deck-list">
              {featuredDecks.map((deck) => (
                <Link key={deck.id} className="dashboard-deck-card" href={`/decks/${deck.id}`}>
                  <div className="dashboard-deck-cover">
                    {deck.deckCoverUrl ? (
                      <img className="deck-cover-image" src={deck.deckCoverUrl} alt={deck.name} loading="lazy" />
                    ) : (
                      <div className="deck-cover-placeholder">Sin imagen</div>
                    )}
                  </div>
                  <div className="dashboard-deck-copy">
                    <strong>{deck.name}</strong>
                    <span>{deck.format}</span>
                    <span>{deck.commander || "Sin comandante"}</span>
                    <span>{deck.totalCardCount ?? 0} cartas</span>
                    <span>{formatDate(deck.createdAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
