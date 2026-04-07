export type DisplayCurrency = "USD" | "EUR";

const DEFAULT_USD_TO_EUR = 0.92;
const MIN_USD_TO_EUR = 0.1;
const MAX_USD_TO_EUR = 5;

function resolveUsdToEurRate() {
  const raw = process.env.NEXT_PUBLIC_USD_TO_EUR?.trim();
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < MIN_USD_TO_EUR || parsed > MAX_USD_TO_EUR) {
    return DEFAULT_USD_TO_EUR;
  }
  return parsed;
}

const USD_TO_EUR_RATE = resolveUsdToEurRate();

export function convertCurrencyAmount(
  amount: number | null | undefined,
  targetCurrency: DisplayCurrency,
  baseCurrency: DisplayCurrency = "USD"
) {
  if (amount == null || !Number.isFinite(amount)) {
    return null;
  }

  if (targetCurrency === baseCurrency) {
    return amount;
  }

  if (baseCurrency === "USD" && targetCurrency === "EUR") {
    return amount * USD_TO_EUR_RATE;
  }

  if (baseCurrency === "EUR" && targetCurrency === "USD") {
    return amount / USD_TO_EUR_RATE;
  }

  return amount;
}

export function formatCurrency(value: number | null | undefined, currency = "USD") {
  const normalizedCurrency = (currency === "EUR" ? "EUR" : "USD") as DisplayCurrency;
  if (value == null || !Number.isFinite(value)) {
    return "Sin precio";
  }
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: normalizedCurrency,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatDisplayCurrency(
  value: number | null | undefined,
  displayCurrency: DisplayCurrency,
  baseCurrency: DisplayCurrency = "USD"
) {
  return formatCurrency(convertCurrencyAmount(value, displayCurrency, baseCurrency), displayCurrency);
}

export function formatDateTime(value: string | null | undefined, fallback = "Sin dato") {
  if (!value) {
    return fallback;
  }
  return new Date(value).toLocaleString("es-ES");
}

export function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "Sin dato";
  }
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

export function buySignalLabel(signal: string) {
  switch (signal) {
    case "good-moment":
      return "Buen momento";
    case "expensive-now":
      return "Caro ahora";
    default:
      return "En rango";
  }
}

export function buySignalClass(signal: string) {
  switch (signal) {
    case "good-moment":
      return "positive";
    case "expensive-now":
      return "negative";
    default:
      return "neutral";
  }
}

export function valueDeltaClass(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

export function historyStatusLabel(status: string) {
  switch (status) {
    case "available":
      return "Disponible";
    case "limited":
      return "Historial corto";
    default:
      return "Sin historial";
  }
}

export function historyStatusDescription(status: string) {
  switch (status) {
    case "available":
      return "Hay suficiente historial local para ver una tendencia util.";
    case "limited":
      return "Hay pocos datos recientes; usalo como orientacion.";
    default:
      return "Todavia no hay historial local suficiente.";
  }
}

export function buildSparklinePoints(points: Array<{ priceUsd: number }>) {
  if (points.length < 2) {
    return "";
  }
  const ordered = [...points].reverse();
  const prices = ordered.map((point) => point.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  return ordered.map((point, index) => {
    const x = (index / Math.max(ordered.length - 1, 1)) * 100;
    const y = 100 - (((point.priceUsd - min) / span) * 100);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function isLikelyStale(lastCapturedAt: string | null | undefined, thresholdHours = 24) {
  if (!lastCapturedAt) {
    return false;
  }
  const timestamp = new Date(lastCapturedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Date.now() - timestamp >= thresholdHours * 60 * 60 * 1000;
}

export function freshnessLabel(lastCapturedAt: string | null | undefined, thresholdHours = 24) {
  if (!lastCapturedAt) {
    return "Sin dato reciente";
  }

  const timestamp = new Date(lastCapturedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return "Sin dato reciente";
  }

  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (ageHours >= thresholdHours) {
    return "Dato antiguo";
  }

  return "Dato reciente";
}
