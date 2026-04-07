import { type CardPriceLookupResult } from "@/lib/types";
import { readDatabase } from "@/lib/server/mtg-store";
import { getCardPriceByExactName, getCardPriceByFuzzyName, ScryfallRouteError, toErrorResponse } from "@/lib/scryfall/server";

type PriceHistoryPoint = {
  capturedAt: string;
  priceUsd: number;
};

function normalize(value: string | null | undefined): string {
  return value == null ? "" : value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const key = normalize(value);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push(value.trim());
  }

  return ordered;
}

function extractCandidateCardNames(rawName: string): string[] {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [trimmed];

  for (const match of trimmed.matchAll(/["']([^"']{2,})["']/g)) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }

  const sanitized = trimmed
    .replace(/\b(price history|price|prices|pricing|history|trend|cost|value|current|now|today|usd|eur|how much|what is|what's|precio|historial|tendencia|cuanto|vale|carta|card|mtg|magic)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length > 1) {
    candidates.push(sanitized);
  }

  const colonSuffix = trimmed.includes(":") ? trimmed.slice(trimmed.lastIndexOf(":") + 1).trim() : "";
  if (colonSuffix.length > 1) {
    candidates.push(colonSuffix);
  }

  return unique(candidates);
}

async function resolveCardForPriceQuery(rawName: string): Promise<CardPriceLookupResult> {
  const candidates = extractCandidateCardNames(rawName);
  if (candidates.length === 0) {
    throw new ScryfallRouteError(400, "name must not be blank", [], "invalid_request");
  }

  for (const candidate of candidates) {
    try {
      return await getCardPriceByExactName(candidate);
    } catch (error) {
      if (!(error instanceof ScryfallRouteError) || error.status !== 404) {
        throw error;
      }
    }
  }

  for (const candidate of candidates) {
    try {
      return await getCardPriceByFuzzyName(candidate);
    } catch (error) {
      if (!(error instanceof ScryfallRouteError) || error.status !== 404) {
        throw error;
      }
    }
  }

  throw new ScryfallRouteError(404, "Card not found for price query", [], "not_found");
}

function buildLocalPriceHistory(card: CardPriceLookupResult) {
  return readDatabase().then((database) => {
    const snapshotById = new Map(database.deckValueSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const deduped = new Map<string, PriceHistoryPoint>();
    const cardId = normalize(card.scryfallId);
    const cardName = normalize(card.name);

    for (const snapshot of database.cardValueSnapshots) {
      if (snapshot.unitPrice == null) {
        continue;
      }

      const matchesById = cardId && normalize(snapshot.scryfallId) === cardId;
      const matchesByName = normalize(snapshot.cardName) === cardName;
      if (!matchesById && !matchesByName) {
        continue;
      }

      const deckSnapshot = snapshotById.get(snapshot.deckSnapshotId);
      if (!deckSnapshot) {
        continue;
      }

      const priceUsd = Number(snapshot.unitPrice.toFixed(2));
      const key = `${deckSnapshot.snapshotAt}:${priceUsd.toFixed(2)}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          capturedAt: deckSnapshot.snapshotAt,
          priceUsd
        });
      }
    }

    const history = [...deduped.values()]
      .sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime())
      .slice(0, 12);

    const currentPriceUsd = card.priceUsd == null ? null : Number(card.priceUsd.toFixed(2));
    const referencePriceUsd = history.length > 0
      ? Number((history.reduce((sum, point) => sum + point.priceUsd, 0) / history.length).toFixed(2))
      : null;
    const deltaFromReferenceUsd = currentPriceUsd != null && referencePriceUsd != null
      ? Number((currentPriceUsd - referencePriceUsd).toFixed(2))
      : null;
    const deltaFromReferencePercent = deltaFromReferenceUsd != null && referencePriceUsd != null && referencePriceUsd > 0
      ? Number(((deltaFromReferenceUsd / referencePriceUsd) * 100).toFixed(2))
      : null;

    const historyStatus: "none" | "limited" | "available" = history.length === 0 ? "none" : history.length === 1 ? "limited" : "available";
    const note = historyStatus === "none"
      ? "Sin historial local todavia. Solo se muestra el precio actual de Scryfall."
      : historyStatus === "limited"
        ? "Solo hay un punto local de historial. La comparativa es orientativa."
        : "Historial local construido desde snapshots guardados en esta app.";

    return {
      currentPriceUsd,
      history,
      referencePriceUsd,
      deltaFromReferenceUsd,
      deltaFromReferencePercent,
      historyStatus,
      note
    };
  });
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!name.trim()) {
    return Response.json(
      {
        message: "Validation failed",
        errors: ["name must not be blank"]
      },
      { status: 400 }
    );
  }

  try {
    const card = await resolveCardForPriceQuery(name);
    const summary = await buildLocalPriceHistory(card);

    return Response.json({
      query: name.trim(),
      card,
      ...summary
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
