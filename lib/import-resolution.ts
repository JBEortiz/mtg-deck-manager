import { buildLookupCandidates } from "./decklist-import";
import type { CardLookupResult } from "./types";

export type ImportLookupError = {
  code: string;
  message: string;
  status: number;
};

export type ImportLookupMode = "exact" | "fuzzy";

export type ImportLookupFn = (name: string, mode: ImportLookupMode) => Promise<CardLookupResult>;

export type ImportDecklistEntry = {
  lineNumbers: number[];
  name: string;
  quantity: number;
  rawLines: string[];
};

export type ImportEntryResolution =
  | {
      ok: true;
      entry: ImportDecklistEntry;
      lookup?: CardLookupResult;
      failure?: ImportLookupError;
      resolvedBy: "exact" | "normalized-exact" | "fuzzy" | "fallback-inferred";
    }
  | {
      ok: false;
      entry: ImportDecklistEntry;
      failure: ImportLookupError;
      resolvedBy: "unresolved";
    };

function shouldFallbackImport(error: ImportLookupError) {
  return error.status === 429 || error.status === 504 || error.status >= 500;
}

function toLookupError(error: unknown): ImportLookupError {
  if (typeof error === "object" && error !== null) {
    const status = typeof Reflect.get(error, "status") === "number" ? Number(Reflect.get(error, "status")) : 500;
    const code = typeof Reflect.get(error, "code") === "string" ? String(Reflect.get(error, "code")) : "lookup_failed";
    const message = typeof Reflect.get(error, "message") === "string" ? String(Reflect.get(error, "message")) : "Lookup failed";
    return { status, code, message };
  }

  return {
    status: 500,
    code: "lookup_failed",
    message: "Lookup failed"
  };
}

export async function resolveImportEntryWithFallback(
  entry: ImportDecklistEntry,
  lookupCard: ImportLookupFn
): Promise<ImportEntryResolution> {
  const candidates = buildLookupCandidates(entry.name);
  let lastFailure: ImportLookupError | null = null;
  let fallbackFailure: ImportLookupError | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] ?? entry.name;

    try {
      const lookup = await lookupCard(candidate, "exact");
      return {
        ok: true,
        entry,
        lookup,
        resolvedBy: index === 0 ? "exact" : "normalized-exact"
      };
    } catch (error) {
      const failure = toLookupError(error);
      lastFailure = failure;
      if (shouldFallbackImport(failure)) {
        fallbackFailure = fallbackFailure ?? failure;
      }
      if (failure.status !== 404) {
        break;
      }
    }
  }

  const fuzzyCandidate = candidates[candidates.length - 1] ?? entry.name;
  try {
    const lookup = await lookupCard(fuzzyCandidate, "fuzzy");
    return {
      ok: true,
      entry,
      lookup,
      resolvedBy: "fuzzy"
    };
  } catch (error) {
    const failure = toLookupError(error);
    lastFailure = failure;
    if (shouldFallbackImport(failure)) {
      fallbackFailure = fallbackFailure ?? failure;
    }
  }

  if (fallbackFailure) {
    return {
      ok: true,
      entry,
      failure: fallbackFailure,
      resolvedBy: "fallback-inferred"
    };
  }

  return {
    ok: false,
    entry,
    failure: lastFailure ?? {
      status: 404,
      code: "not_found",
      message: "Card not found"
    },
    resolvedBy: "unresolved"
  };
}

export async function resolveImportEntriesWithFallback(
  entries: ImportDecklistEntry[],
  lookupCard: ImportLookupFn,
  concurrency = 6
) {
  const results: ImportEntryResolution[] = new Array(entries.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= entries.length) {
        return;
      }

      results[currentIndex] = await resolveImportEntryWithFallback(entries[currentIndex], lookupCard);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, entries.length)) }, () => worker()));
  return results;
}
