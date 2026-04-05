import { buildLookupCandidates } from "@/lib/decklist-import";
import type { CardLookupResult } from "@/lib/types";

export type MetadataCardLike = {
  colors: string;
  imageNormal?: string | null;
  imageSmall?: string | null;
  imageUrl?: string | null;
  manaValue: number;
  name: string;
  quantity: number;
  scryfallId?: string | null;
  type: string;
};

export type MetadataSourceCardLike = MetadataCardLike & {
  id?: number | null;
};

export type MetadataLookupMode = "exact" | "fuzzy";

export type MetadataLookupFn = (name: string, mode: MetadataLookupMode) => Promise<CardLookupResult>;

export type MetadataLookupFailure = {
  code: string;
  message: string;
  status: number;
};

export type MetadataResolution =
  | {
      ok: true;
      lookup: CardLookupResult;
      resolvedBy: "exact" | "normalized-exact" | "fuzzy";
    }
  | {
      failure: MetadataLookupFailure;
      ok: false;
      resolvedBy: "unresolved";
    };

function normalize(value: string | null | undefined) {
  return value == null ? "" : value.trim().toLowerCase();
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function isKnownType(typeLine: string | null | undefined) {
  return normalize(typeLine) !== "" && normalize(typeLine) !== "unknown";
}

function isLandType(typeLine: string | null | undefined) {
  return normalize(typeLine).includes("land");
}

function hasCompleteIdentity(card: MetadataCardLike) {
  return Boolean(card.scryfallId && firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl) && isKnownType(card.type));
}

function needsManaRepair(card: MetadataCardLike) {
  return card.manaValue === 0 && !isLandType(card.type);
}

function needsStrongMetadataEnrichment(card: MetadataCardLike) {
  return !hasCompleteIdentity(card);
}

export function needsMetadataEnrichment(card: MetadataCardLike) {
  if (needsStrongMetadataEnrichment(card)) {
    return true;
  }

  return needsManaRepair(card);
}

function metadataPriority(card: MetadataCardLike, commanderName?: string | null) {
  let score = 0;

  if (normalize(card.name) === normalize(commanderName)) {
    score += 100;
  }

  if (!card.scryfallId) {
    score += 40;
  }

  if (!firstNonBlank(card.imageNormal, card.imageSmall, card.imageUrl)) {
    score += 35;
  }

  if (!isKnownType(card.type)) {
    score += 30;
  }

  if (needsManaRepair(card)) {
    score += 10;
  }

  return score;
}

export function selectMetadataEnrichmentCandidates<T extends MetadataCardLike & { id: number }>(
  cards: T[],
  commanderName?: string | null,
  limit = 24
) {
  return [...cards]
    .filter((card) => needsMetadataEnrichment(card))
    .sort((left, right) => {
      const priorityDiff = metadataPriority(right, commanderName) - metadataPriority(left, commanderName);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return left.id - right.id;
    })
    .slice(0, Math.max(0, limit));
}

function toLookupFailure(error: unknown): MetadataLookupFailure {
  if (typeof error === "object" && error !== null) {
    return {
      status: typeof Reflect.get(error, "status") === "number" ? Number(Reflect.get(error, "status")) : 500,
      code: typeof Reflect.get(error, "code") === "string" ? String(Reflect.get(error, "code")) : "lookup_failed",
      message: typeof Reflect.get(error, "message") === "string" ? String(Reflect.get(error, "message")) : "Lookup failed"
    };
  }

  return {
    status: 500,
    code: "lookup_failed",
    message: "Lookup failed"
  };
}

export async function resolveMetadataLookup(name: string, lookupCard: MetadataLookupFn): Promise<MetadataResolution> {
  const candidates = buildLookupCandidates(name);
  let lastFailure: MetadataLookupFailure | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] ?? name;

    try {
      const lookup = await lookupCard(candidate, "exact");
      return {
        ok: true,
        lookup,
        resolvedBy: index === 0 ? "exact" : "normalized-exact"
      };
    } catch (error) {
      const failure = toLookupFailure(error);
      lastFailure = failure;
      if (failure.status !== 404) {
        break;
      }
    }
  }

  try {
    const lookup = await lookupCard(candidates[candidates.length - 1] ?? name, "fuzzy");
    return {
      ok: true,
      lookup,
      resolvedBy: "fuzzy"
    };
  } catch (error) {
    lastFailure = toLookupFailure(error);
  }

  return {
    ok: false,
    failure: lastFailure ?? {
      status: 404,
      code: "not_found",
      message: "Card not found"
    },
    resolvedBy: "unresolved"
  };
}

export function countPendingMetadataCards(cards: MetadataCardLike[]) {
  return cards.filter((card) => needsStrongMetadataEnrichment(card)).length;
}

function hasReusableMetadata(card: MetadataCardLike) {
  return !needsMetadataEnrichment(card);
}

function metadataMatchScore(target: MetadataCardLike, candidate: MetadataCardLike) {
  let score = 0;

  if (normalize(target.scryfallId) && normalize(target.scryfallId) === normalize(candidate.scryfallId)) {
    score += 1000;
  }

  if (normalize(target.name) === normalize(candidate.name)) {
    score += 500;
  }

  if (hasCompleteIdentity(candidate)) {
    score += 100;
  }

  if (firstNonBlank(candidate.imageNormal, candidate.imageSmall, candidate.imageUrl)) {
    score += 30;
  }

  if (isKnownType(candidate.type)) {
    score += 20;
  }

  if (!needsManaRepair(candidate)) {
    score += 10;
  }

  return score;
}

export function findReusableMetadata<T extends MetadataSourceCardLike>(
  target: MetadataCardLike,
  candidates: T[]
): T | null {
  const normalizedTargetName = normalize(target.name);
  const normalizedTargetScryfallId = normalize(target.scryfallId);
  const exactMatches = candidates
    .filter((candidate) => {
      if (candidate === target) {
        return false;
      }

      const sameScryfallId = normalizedTargetScryfallId && normalizedTargetScryfallId === normalize(candidate.scryfallId);
      const sameName = normalizedTargetName && normalizedTargetName === normalize(candidate.name);
      return (sameScryfallId || sameName) && hasReusableMetadata(candidate);
    })
    .sort((left, right) => metadataMatchScore(target, right) - metadataMatchScore(target, left));

  return exactMatches[0] ?? null;
}

export function mergeReusableMetadata<T extends MetadataCardLike>(target: T, source: MetadataCardLike): T {
  return {
    ...target,
    manaValue: (!needsManaRepair(source) && (target.manaValue <= 0 || needsManaRepair(target))) ? source.manaValue : target.manaValue,
    type: isKnownType(target.type) ? target.type : source.type,
    colors: normalize(target.colors) !== "colorless" && normalize(target.colors) !== "c" ? target.colors : source.colors,
    scryfallId: target.scryfallId ?? source.scryfallId ?? null,
    imageSmall: target.imageSmall ?? source.imageSmall ?? null,
    imageNormal: target.imageNormal ?? source.imageNormal ?? null,
    imageUrl: firstNonBlank(target.imageNormal, source.imageNormal, target.imageSmall, source.imageSmall, target.imageUrl, source.imageUrl)
  };
}
