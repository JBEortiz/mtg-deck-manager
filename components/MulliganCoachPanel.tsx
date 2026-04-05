"use client";

import { useMemo, useState } from "react";

import type { DeckPassport, MulliganSample } from "@/lib/types";

type MulliganCoachPanelProps = {
  passport: DeckPassport | null;
  passportError: string;
  mulliganSample: MulliganSample | null;
  mulliganError: string;
  loadingMulligan: boolean;
  onDrawNewHand: () => void;
};

type DeckHint = {
  label: string;
  note: string;
};

type MulliganMetric = {
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
};

function signalLabel(value: boolean, positive = "Si", negative = "No") {
  return value ? positive : negative;
}

function sumManaCurve(passport: DeckPassport, maxManaValue: number) {
  return Object.entries(passport.manaCurve)
    .filter(([manaValue]) => Number(manaValue) <= maxManaValue)
    .reduce((total, [, count]) => total + count, 0);
}

function sumHighCurve(passport: DeckPassport, minManaValue: number) {
  return Object.entries(passport.manaCurve)
    .filter(([manaValue]) => Number(manaValue) >= minManaValue)
    .reduce((total, [, count]) => total + count, 0);
}

function buildDeckHints(passport: DeckPassport): DeckHint[] {
  const totalCards = Math.max(passport.totalCards, 1);
  const cheapCards = sumManaCurve(passport, 2);
  const highCurveCards = sumHighCurve(passport, 5);
  const cheapRatio = cheapCards / totalCards;
  const highCurveRatio = highCurveCards / totalCards;
  const interactionCount = passport.roles.removal + passport.roles.boardWipes;

  const preferredLands = passport.roles.ramp >= 8
    ? "2-3 tierras suelen bastar si una conecta con una pieza de ramp."
    : highCurveRatio >= 0.3
      ? "Busca 3-4 tierras para no quedarte atascado con la parte alta de la curva."
      : "2-4 tierras suele ser el rango mas estable para este inicio.";

  const rampHint = passport.roles.ramp >= 8
    ? "El ramp temprano empuja muchos keeps porque este deck quiere adelantarse en mana."
    : passport.roles.ramp >= 4
      ? "El ramp suma, pero sigue pesando mas una base de mana limpia."
      : "Aqui importa mas curvar bien que encontrar ramp en los primeros turnos.";

  const interactionHint = interactionCount >= 8
    ? "La interaccion barata vale mucho porque este deck puede responder desde el inicio."
    : interactionCount >= 5
      ? "La respuesta temprana ayuda, pero no arregla una mano floja de mana."
      : "Suele ser mejor desarrollar mesa primero y dejar la interaccion para despues.";

  const setupHint = passport.roles.draw >= 6
    ? "Las piezas de setup y robo son buenos keeps si el mana acompana."
    : passport.roles.protection >= 4 || passport.gamePlan.toLowerCase().includes("value")
      ? "El valor incremental sirve, pero solo cuando el arranque ya es estable."
      : "Prioriza una salida funcional antes que cartas lentas de preparacion.";

  const speedHint = passport.roles.ramp >= 8 || highCurveRatio >= 0.3
    ? "Este deck acepta manos un poco mas lentas si la base de mana es buena."
    : cheapRatio >= 0.2 || interactionCount >= 8
      ? "Este deck agradece tener accion antes del turno dos."
      : "La mejor mano aqui suele ser equilibrada: mana estable y una jugada util.";

  return [
    { label: "Tierras preferidas", note: preferredLands },
    { label: "Ramp temprano", note: rampHint },
    { label: "Interaccion barata", note: interactionHint },
    { label: "Setup / valor", note: setupHint },
    { label: "Velocidad", note: speedHint }
  ];
}

function buildMetrics(sample: MulliganSample): MulliganMetric[] {
  return [
    {
      label: "Tierras",
      value: String(sample.landCount),
      tone: sample.landCount >= 2 && sample.landCount <= 4 ? "good" : "warn"
    },
    {
      label: "Jugada temprana",
      value: signalLabel(sample.hasEarlyPlayable),
      tone: sample.hasEarlyPlayable ? "good" : "warn"
    },
    {
      label: "Acceso a color",
      value: signalLabel(sample.hasColorAccess, "Bueno", "Tenso"),
      tone: sample.hasColorAccess ? "good" : "warn"
    },
    {
      label: "Ramp",
      value: signalLabel(sample.hasRamp),
      tone: sample.hasRamp ? "good" : "neutral"
    },
    {
      label: "Robo",
      value: signalLabel(sample.hasDraw),
      tone: sample.hasDraw ? "good" : "neutral"
    },
    {
      label: "Curva",
      value: signalLabel(sample.fitsEarlyCurve, "En plan", "Lenta"),
      tone: sample.fitsEarlyCurve ? "good" : "warn"
    }
  ];
}

export default function MulliganCoachPanel({
  passport,
  passportError,
  mulliganSample,
  mulliganError,
  loadingMulligan,
  onDrawNewHand
}: MulliganCoachPanelProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const verdictClass = mulliganSample ? `mulligan-${mulliganSample.verdict.toLowerCase()}` : "";
  const deckHints = passport ? buildDeckHints(passport) : [];
  const metrics = useMemo(() => (mulliganSample ? buildMetrics(mulliganSample) : []), [mulliganSample]);
  const previewCard = previewIndex !== null && mulliganSample ? mulliganSample.cards[previewIndex] ?? null : null;

  return (
    <section className="panel mulligan-panel">
      <div className="section-header-inline mulligan-header">
        <div className="mulligan-header-copy">
          <h3>Mulligan Coach</h3>
          <p className="muted">Lee la mano rapido y deja el analisis detallado para despues.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={onDrawNewHand} disabled={loadingMulligan}>
          {loadingMulligan ? "Robando..." : "Nueva mano"}
        </button>
      </div>

      {mulliganError ? (
        <p className="notice-banner error-banner">{mulliganError}</p>
      ) : !mulliganSample ? (
        <div className="empty-state compact-empty-state">
          <h4>Todavia no hay mano inicial disponible.</h4>
          <p className="muted">Roba una mano para ver el veredicto, las cartas y las pistas del deck.</p>
        </div>
      ) : (
        <div className={`mulligan-hero ${verdictClass}`}>
          <div className="mulligan-verdict-row">
            <div className="mulligan-verdict-copy">
              <span className={`status-pill mulligan-verdict-pill ${verdictClass}`}>{mulliganSample.verdict}</span>
              <div className="mulligan-summary-copy">
                <h4>Mano inicial</h4>
                <p>{mulliganSample.note}</p>
              </div>
            </div>
            <p className="mulligan-hand-caption">Pasa el cursor para ampliar. En movil, toca una carta.</p>
          </div>

          <div className="mulligan-chip-row" aria-label="Resumen rapido de la mano">
            {metrics.map((metric) => (
              <article key={metric.label} className={`mulligan-metric-chip mulligan-metric-${metric.tone}`}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </article>
            ))}
          </div>

          <section className="mulligan-hand-stage" aria-label="Opening hand">
            <div className="mulligan-hand-fan">
              {mulliganSample.cards.map((card, index) => (
                <button
                  key={`${card.name}-${index}`}
                  className="mulligan-hand-card"
                  type="button"
                  onClick={() => setPreviewIndex(index)}
                  aria-label={`Abrir vista ampliada de ${card.name}`}
                >
                  {card.imageUrl ? (
                    <img className="mulligan-hand-card-image" src={card.imageUrl} alt={card.name} loading="lazy" />
                  ) : (
                    <div className="mulligan-hand-card-image card-preview-thumb-placeholder">Sin imagen</div>
                  )}
                  <div className="mulligan-hand-card-overlay">
                    <strong>{card.name}</strong>
                    <span>{card.isLand ? "Tierra" : `MV ${card.manaValue}`}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <details className="mulligan-details">
            <summary>
              <span>Analisis detallado</span>
              <span className="mulligan-details-hint">Ver por que esta mano encaja o no</span>
            </summary>

            <div className="mulligan-details-grid">
              <section className="mulligan-details-block">
                <div className="mulligan-details-title-row">
                  <h4>Lectura de la mano</h4>
                  <span className={`status-pill ${verdictClass}`}>{mulliganSample.verdict}</span>
                </div>
                {mulliganSample.signals.length > 0 ? (
                  <div className="mulligan-signal-list">
                    {mulliganSample.signals.map((signal) => (
                      <p key={signal} className="mulligan-signal">{signal}</p>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No hay observaciones extra para esta mano.</p>
                )}
              </section>

              <section className="mulligan-details-block">
                <div className="mulligan-details-title-row">
                  <h4>Lo que busca este deck</h4>
                  {passport && <span className="status-badge">{passport.commander}</span>}
                </div>
                {passportError ? (
                  <p className="muted">Las pistas del deck no estan disponibles hasta cargar el passport.</p>
                ) : !passport ? (
                  <p className="muted">Anade mas cartas para generar recomendaciones de mulligan mas utiles.</p>
                ) : (
                  <div className="mulligan-hint-grid">
                    {deckHints.map((hint) => (
                      <article key={hint.label} className="mulligan-hint-card">
                        <span>{hint.label}</span>
                        <p>{hint.note}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </details>
        </div>
      )}

      {previewCard && (
        <div
          className="lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Vista ampliada de ${previewCard.name}`}
          onClick={() => setPreviewIndex(null)}
        >
          <div className="lightbox-panel mulligan-preview-panel" onClick={(event) => event.stopPropagation()}>
            {previewCard.imageUrl ? (
              <img className="lightbox-image mulligan-preview-image" src={previewCard.imageUrl} alt={previewCard.name} />
            ) : (
              <div className="lightbox-image card-preview-thumb-placeholder">Sin imagen</div>
            )}
            <div className="mulligan-preview-copy">
              <div>
                <h4>{previewCard.name}</h4>
                <p className="muted">{previewCard.type}</p>
              </div>
              <span className="status-badge">{previewCard.isLand ? "Tierra" : `MV ${previewCard.manaValue}`}</span>
            </div>
            <button className="btn" type="button" onClick={() => setPreviewIndex(null)}>
              Cerrar vista
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
