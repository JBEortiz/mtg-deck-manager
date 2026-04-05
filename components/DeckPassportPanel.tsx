"use client";

import { useState } from "react";
import ManaSymbolRow from "@/components/ManaSymbolRow";
import type { DeckPassport } from "@/lib/types";

type DeckPassportPanelProps = {
  passport: DeckPassport | null;
  passportError: string;
  selectedDeckCoverUrl: string | null;
};

const ROLE_LABELS: Array<{ key: keyof DeckPassport["roles"]; label: string }> = [
  { key: "ramp", label: "Ramp" },
  { key: "draw", label: "Robo" },
  { key: "removal", label: "Removal" },
  { key: "boardWipes", label: "Wraths" },
  { key: "protection", label: "Proteccion" },
  { key: "finishers", label: "Finalizadores" }
];

const COLOR_LABELS: Record<string, string> = {
  W: "Blanco",
  U: "Azul",
  B: "Negro",
  R: "Rojo",
  G: "Verde",
  C: "Incoloro"
};

function formatWatchout(watchout: DeckPassport["rulesWatchouts"][number]) {
  return `${watchout.label}: ${watchout.description} Stack/timing: ${watchout.commonStackUsage}. Note: ${watchout.practicalNote}`;
}

function formatPassportText(passport: DeckPassport) {
  const colors = passport.colors.length > 0
    ? passport.colors.map((color) => COLOR_LABELS[color] ?? color).join(", ")
    : "Todavia sin colores";
  const warnings = passport.warnings.length > 0
    ? passport.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- No se detectaron puntos debiles claros con las heuristicas actuales.";
  const watchouts = passport.rulesWatchouts.length > 0
    ? passport.rulesWatchouts.map((watchout) => `- ${formatWatchout(watchout)}`).join("\n")
    : "- No se detectaron mecanicas especialmente sensibles a reglas con las heuristicas actuales.";

  return [
    `${passport.deckName} - Passport del deck`,
    `Formato: ${passport.format}`,
    `Comandante: ${passport.commander || "Sin comandante"}`,
    `Colores: ${colors}`,
    `Total de cartas: ${passport.totalCards}`,
    "",
    "Que hace este deck",
    `- Plan de juego: ${passport.gamePlan}`,
    `- Forma probable de cerrar la partida: ${passport.winPlan}`,
    `- Plan temprano: ${passport.earlyGamePlan}`,
    "",
    "Roles funcionales",
    ROLE_LABELS.map((role) => `${role.label}: ${passport.roles[role.key]}`).join(" | "),
    "",
    "Advertencias / Puntos debiles",
    warnings,
    "",
    "Alertas de reglas",
    watchouts
  ].join("\n");
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

export default function DeckPassportPanel({ passport, passportError, selectedDeckCoverUrl }: DeckPassportPanelProps) {
  const [exportNotice, setExportNotice] = useState("");
  const [exportError, setExportError] = useState("");

  const onCopyPassport = async () => {
    if (!passport) {
      return;
    }

    setExportNotice("");
    setExportError("");
    const text = formatPassportText(passport);

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
      setExportNotice("Passport copiado al portapapeles.");
    } else {
      setExportError("No se pudo copiar el passport. Usa Exportar texto.");
    }
  };

  const onDownloadPassport = () => {
    if (!passport) {
      return;
    }

    const safeName = passport.deckName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const filename = `${safeName || "deck"}-passport.txt`;
    const blob = new Blob([formatPassportText(passport)], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setExportNotice(`Passport exportado como ${filename}.`);
    setExportError("");
  };

  return (
    <section className="panel">
      <div className="section-header-inline">
        <h3>Deck Passport</h3>
        <span className="status-pill">Heuristico</span>
      </div>
      {passportError ? (
        <p className="notice-banner error-banner">{passportError}</p>
      ) : !passport ? (
        <p className="muted">No hay passport disponible.</p>
      ) : (
        <div className="passport-layout">
          <section className="passport-block">
            <div className="passport-identity-grid">
              {selectedDeckCoverUrl ? (
                <img className="passport-cover" src={selectedDeckCoverUrl} alt={`${passport.deckName} cover`} loading="lazy" />
              ) : (
                <div className="passport-cover deck-card-cover-placeholder">Sin portada</div>
              )}
              <div className="passport-identity-copy">
                <h4>{passport.deckName}</h4>
                <p className="muted">{passport.format} | Comandante: {passport.commander || "Sin comandante"}</p>
                <ManaSymbolRow colors={passport.colors} emptyLabel="Todavia sin colores" />
              </div>
            </div>
          </section>

          <section className="passport-block">
            <h4>Que hace este deck</h4>
            <div className="passport-summary-grid">
              <div className="passport-summary-item">
                <span>Plan de juego</span>
                <p>{passport.gamePlan}</p>
              </div>
              <div className="passport-summary-item">
                <span>Forma de cierre</span>
                <p>{passport.winPlan}</p>
              </div>
              <div className="passport-summary-item">
                <span>Plan temprano</span>
                <p>{passport.earlyGamePlan}</p>
              </div>
            </div>
          </section>

          <section className="passport-block">
            <h4>Roles funcionales</h4>
            <div className="passport-role-grid">
              {ROLE_LABELS.map((role) => (
                <div key={role.key} className="stat-card passport-role-card">
                  <span>{role.label}</span>
                  <strong>{passport.roles[role.key]}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="passport-block">
            <h4>Advertencias / Puntos debiles</h4>
            {passport.warnings.length > 0 ? (
              <ul className="validation-list info-list">
                {passport.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : (
              <p className="muted">No se detectaron puntos debiles claros con las heuristicas actuales.</p>
            )}
          </section>

          <section className="passport-block">
            <h4>Alertas de reglas</h4>
            {passport.rulesWatchouts.length > 0 ? (
              <div className="passport-summary-grid">
                {passport.rulesWatchouts.map((watchout) => (
                  <div key={watchout.label} className="passport-summary-item">
                    <span>{watchout.label}</span>
                    <p>{watchout.description}</p>
                    <p><strong>Pila / timing:</strong> {watchout.commonStackUsage}</p>
                    <p><strong>Nota:</strong> {watchout.practicalNote}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No se detectaron mecanicas especialmente sensibles a reglas con las heuristicas actuales.</p>
            )}
          </section>

          <section className="passport-block">
            <h4>Exportar / Compartir</h4>
            <p className="muted">Copia un resumen del deck o exportalo como texto plano.</p>
            <div className="button-row-inline">
              <button className="btn btn-secondary" type="button" onClick={() => void onCopyPassport()}>Copiar resumen</button>
              <button className="btn btn-secondary" type="button" onClick={onDownloadPassport}>Exportar texto</button>
            </div>
            {exportNotice && <p className="muted">{exportNotice}</p>}
            {exportError && <p className="notice-banner error-banner">{exportError}</p>}
          </section>
        </div>
      )}
    </section>
  );
}
