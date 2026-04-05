export type DecklistPreviewItem = {
  key: string;
  lineNumbers: number[];
  name: string;
  quantity: number;
  rawLines: string[];
};

export type DecklistPreviewError = {
  kind?: "parse";
  line: number;
  message: string;
  rawLine: string;
};

export type DecklistPreview = {
  detectedSource: "generic" | "moxfield" | "edhrec";
  detectedSourceLabel: string;
  commanderEntries: string[];
  totalPastedLines: number;
  ignoredBlankLines: number;
  ignoredSectionLines: number;
  parsedLines: number;
  duplicatesConsolidated: number;
  nonEmptyLineCount: number;
  recognizedEntries: DecklistPreviewItem[];
  unrecognizedLines: DecklistPreviewError[];
};

export type ResolvedDecklistEntry = {
  name: string;
  originalName?: string;
  quantity: number;
  type?: string | null;
};

const GENERIC_DECKLIST_LINE_PATTERN = /^(\d+)\s*x?\s+(.+)$/i;
const SITE_DECKLIST_LINE_PATTERNS = [
  /^(\d+)\s*x?\s+(.+)$/i,
  /^(.+?)\s+x\s*(\d+)$/i
] as const;
const SIMPLE_NAME_ONLY_PATTERN = /^([^\d].+)$/;
const MOXFIELD_MARKERS = [/moxfield\.com/i, /^mainboard$/i, /^sideboard$/i, /^maybeboard$/i, /^commanders?$/i];
const EDHREC_MARKERS = [/edhrec\.com/i, /^average deck$/i, /^signature cards$/i, /^top cards$/i];
const SHARED_SECTION_HEADERS = [
  /^deck$/i,
  /^commander$/i,
  /^mainboard$/i,
  /^sideboard$/i,
  /^maybeboard$/i,
  /^companions?$/i,
  /^commanders?$/i,
  /^creatures?$/i,
  /^instants?$/i,
  /^sorceries?$/i,
  /^artifacts?$/i,
  /^enchantments?$/i,
  /^planeswalkers?$/i,
  /^battles?$/i,
  /^lands?$/i,
  /^tokens?$/i
] as const;
const COUNTED_SECTION_HEADER = /^[A-Za-z][A-Za-z0-9 '&,/:-]+(?:\s+\(\d+\))$/;

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function isCommanderFormat(format: string) {
  return format.trim().toLowerCase() === "commander";
}

function isCommanderCandidateType(typeLine: string | null | undefined) {
  const normalizedType = normalizeName(typeLine ?? "");
  return normalizedType.includes("legendary") && (normalizedType.includes("creature") || normalizedType.includes("planeswalker"));
}

function sanitizeDecklistLine(line: string) {
  return line
    .replace(/^\s*(?:[-*•]\s+|\[\s?\]\s+|\(\s?\)\s+)/, "")
    .trim();
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingDeckMetadata(name: string) {
  return collapseWhitespace(
    name
      .replace(/\s+\[[A-Z0-9]{2,6}\]$/i, "")
      .replace(/\s+\([A-Z0-9]{2,6}\)\s+\d+[a-z]?$/i, "")
      .replace(/\s+\([A-Z0-9]{2,6}\)$/i, "")
      .replace(/\s+\d+[a-z]?\s*$/i, "")
      .replace(/\s+\*F\*\s*$/i, "")
      .replace(/\s+\*E\*\s*$/i, "")
  );
}

export function buildLookupCandidates(name: string) {
  const trimmed = collapseWhitespace(name);
  const stripped = stripTrailingDeckMetadata(trimmed);
  const candidates = [trimmed];

  if (stripped && normalizeName(stripped) !== normalizeName(trimmed)) {
    candidates.push(stripped);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function detectDecklistSource(lines: string[]) {
  const trimmedLines = lines.map((line) => line.trim()).filter(Boolean);

  if (trimmedLines.some((line) => MOXFIELD_MARKERS.some((pattern) => pattern.test(line)))) {
    return { kind: "moxfield" as const, label: "Moxfield / deck site" };
  }

  if (trimmedLines.some((line) => EDHREC_MARKERS.some((pattern) => pattern.test(line)))) {
    return { kind: "edhrec" as const, label: "EDHREC preview" };
  }

  if (trimmedLines.some((line) => COUNTED_SECTION_HEADER.test(line))) {
    return { kind: "edhrec" as const, label: "EDHREC-style sections" };
  }

  return { kind: "generic" as const, label: "Decklist simple" };
}

function isContextHeader(line: string, sourceKind: DecklistPreview["detectedSource"]) {
  if (SHARED_SECTION_HEADERS.some((pattern) => pattern.test(line))) {
    return true;
  }

  if (COUNTED_SECTION_HEADER.test(line)) {
    return true;
  }

  return false;
}

function getSectionKind(line: string, sourceKind: DecklistPreview["detectedSource"]) {
  if (/^commanders?(?:\s+\(\d+\))?$/i.test(line)) {
    return "commander" as const;
  }

  return isContextHeader(line, sourceKind) ? "other" as const : null;
}

function parseRecognizedLine(trimmedLine: string, sourceKind: DecklistPreview["detectedSource"]) {
  const patterns = sourceKind === "generic"
    ? [...SITE_DECKLIST_LINE_PATTERNS, GENERIC_DECKLIST_LINE_PATTERN, SIMPLE_NAME_ONLY_PATTERN]
    : [...SITE_DECKLIST_LINE_PATTERNS, GENERIC_DECKLIST_LINE_PATTERN, SIMPLE_NAME_ONLY_PATTERN];

  const commanderInlineMatch = trimmedLine.match(/^commanders?\s*:\s*(.+)$/i);
  if (commanderInlineMatch) {
    return {
      name: (commanderInlineMatch[1] ?? "").trim(),
      quantity: 1,
      forceCommander: true
    };
  }

  for (const pattern of patterns) {
    const match = trimmedLine.match(pattern);
    if (!match) {
      continue;
    }

    if (pattern === SITE_DECKLIST_LINE_PATTERNS[1]) {
      const name = (match[1] ?? "").trim();
      const quantity = Number.parseInt(match[2] ?? "", 10);
      return { name, quantity };
    }

    if (pattern === SIMPLE_NAME_ONLY_PATTERN) {
      return {
        name: (match[1] ?? "").trim(),
        quantity: 1
      };
    }

    const quantity = Number.parseInt(match[1] ?? "", 10);
    const name = (match[2] ?? "").trim();
    return { name, quantity };
  }

  return null;
}

export function parseDecklistText(decklistText: string): DecklistPreview {
  const consolidated = new Map<string, DecklistPreviewItem>();
  const commanderEntries = new Map<string, string>();
  const unrecognizedLines: DecklistPreviewError[] = [];
  let nonEmptyLineCount = 0;
  let ignoredBlankLines = 0;
  let ignoredSectionLines = 0;
  let parsedLines = 0;
  let currentSectionKind: "commander" | "other" | null = null;

  const lines = decklistText.split(/\r?\n/);
  const totalPastedLines = decklistText.length === 0 ? 0 : lines.length;
  const source = detectDecklistSource(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmedLine = sanitizeDecklistLine(rawLine);

    if (!trimmedLine) {
      ignoredBlankLines += 1;
      continue;
    }

    nonEmptyLineCount += 1;
    const sectionKind = getSectionKind(trimmedLine, source.kind);
    if (sectionKind) {
      currentSectionKind = sectionKind;
      ignoredSectionLines += 1;
      continue;
    }

    const parsed = parseRecognizedLine(trimmedLine, source.kind);
    if (!parsed) {
      unrecognizedLines.push({
        kind: "parse",
        line: lineNumber,
        message: source.kind === "generic"
          ? "No pude leer esta linea como carta. Usa: <cantidad> <nombre de carta>."
          : "No pude leer esta linea del formato pegado. Revisa solo esta parte.",
        rawLine
      });
      continue;
    }

    const { quantity, name, forceCommander = false } = parsed;

    if (!Number.isInteger(quantity) || quantity <= 0 || !name) {
      unrecognizedLines.push({
        kind: "parse",
        line: lineNumber,
        message: "La cantidad debe ser mayor que 0 y el nombre no puede estar vacio.",
        rawLine
      });
      continue;
    }

    parsedLines += 1;
    const key = normalizeName(name);
    if (currentSectionKind === "commander" || forceCommander) {
      commanderEntries.set(key, name);
    }
    const existing = consolidated.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.lineNumbers.push(lineNumber);
      existing.rawLines.push(rawLine);
      continue;
    }

    consolidated.set(key, {
      key,
      lineNumbers: [lineNumber],
      name,
      quantity,
      rawLines: [rawLine]
    });
  }

  const recognizedEntries = [...consolidated.values()];

  return {
    detectedSource: source.kind,
    detectedSourceLabel: source.label,
    commanderEntries: [...commanderEntries.values()],
    totalPastedLines,
    ignoredBlankLines,
    ignoredSectionLines,
    parsedLines,
    duplicatesConsolidated: Math.max(0, parsedLines - recognizedEntries.length),
    nonEmptyLineCount,
    recognizedEntries,
    unrecognizedLines
  };
}

export function inferCommanderFromResolvedEntries(
  format: string,
  commanderEntries: string[],
  resolvedEntries: ResolvedDecklistEntry[]
) {
  if (!isCommanderFormat(format)) {
    return {
      commanderName: null,
      detection: "No aplica a este formato."
    };
  }

  const normalizedCommanderEntries = new Set(commanderEntries.map((entry) => normalizeName(entry)));
  const commanderFromSection = resolvedEntries.find((entry) =>
    normalizedCommanderEntries.has(normalizeName(entry.name)) ||
    normalizedCommanderEntries.has(normalizeName(entry.originalName ?? ""))
  );

  if (commanderFromSection) {
    return {
      commanderName: commanderFromSection.name,
      detection: "Comandante detectado desde la seccion de comandante."
    };
  }

  const lastImportedCandidate = [...resolvedEntries]
    .reverse()
    .find((entry) => entry.quantity === 1 && isCommanderCandidateType(entry.type));

  if (lastImportedCandidate) {
    return {
      commanderName: lastImportedCandidate.name,
      detection: "Comandante inferido desde la ultima carta valida de la lista."
    };
  }

  const singletonCandidates = resolvedEntries.filter((entry) => entry.quantity === 1 && isCommanderCandidateType(entry.type));
  if (singletonCandidates.length === 1) {
    return {
      commanderName: singletonCandidates[0]?.name ?? null,
      detection: "Comandante inferido desde la lista importada."
    };
  }

  return {
    commanderName: null,
    detection: "Sin comandante fiable; la portada usa el primer arte disponible como fallback."
  };
}
