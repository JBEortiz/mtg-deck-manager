import Database from "better-sqlite3";

const dbPath = process.env.MTG_DB_PATH?.trim() || ".data/mtgdeckmanager-next.sqlite";
const db = new Database(dbPath, { readonly: true });

const VALIDATION_NAME_PATTERNS = [
  /\btest\b/i,
  /\bvalidation\b/i,
  /\bretest\b/i,
  /\bcloseout\b/i,
  /\binspect\b/i,
  /\bstable\b/i,
  /\butf8\b/i,
  /\bsmoke\b/i
];
const CLUSTER_WINDOW_MS = 10 * 60 * 1000;
const LOW_CARD_PARTIAL_MAX = 40;

const rows = db.prepare(`
  select
    d.id,
    d.name,
    d.commander,
    d.format,
    d.created_at as createdAt,
    d.owner_user_id as ownerUserId,
    u.email,
    count(c.id) as cardRows,
    coalesce(sum(c.quantity), 0) as totalCards
  from decks d
  left join users u on u.id = d.owner_user_id
  left join cards c on c.deck_id = d.id
  group by d.id, d.name, d.commander, d.format, d.created_at, d.owner_user_id, u.email
  order by d.created_at asc, d.id asc
`).all();

function looksSyntheticByName(name) {
  return VALIDATION_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function validationSignature(name) {
  return name
    .toLowerCase()
    .replace(/\s+\d+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowCardPartialDeck(row) {
  return row.totalCards > 0 && row.totalCards < LOW_CARD_PARTIAL_MAX;
}

const duplicateValidationNameCounts = new Map();
for (const row of rows) {
  if (!looksSyntheticByName(row.name)) {
    continue;
  }

  const key = `${row.ownerUserId}:${validationSignature(row.name)}`;
  duplicateValidationNameCounts.set(key, (duplicateValidationNameCounts.get(key) ?? 0) + 1);
}

function duplicateValidationCount(row) {
  if (!looksSyntheticByName(row.name)) {
    return 0;
  }

  return duplicateValidationNameCounts.get(`${row.ownerUserId}:${validationSignature(row.name)}`) ?? 0;
}

function clusteredValidationCount(target) {
  if (!looksSyntheticByName(target.name)) {
    return 0;
  }

  const targetTime = Date.parse(target.createdAt);
  return rows.filter((row) => {
    if (row.ownerUserId !== target.ownerUserId) {
      return false;
    }

    if (!looksSyntheticByName(row.name)) {
      return false;
    }

    return Math.abs(Date.parse(row.createdAt) - targetTime) <= CLUSTER_WINDOW_MS;
  }).length;
}

function buildReasons(row) {
  const reasons = [];
  const syntheticName = looksSyntheticByName(row.name);
  const clusterCount = clusteredValidationCount(row);
  const duplicateCount = duplicateValidationCount(row);

  if (syntheticName) {
    reasons.push("Name matches obvious validation/test naming.");
  }

  if (syntheticName && duplicateCount >= 2) {
    reasons.push(`Name signature appears duplicated for the same owner (${duplicateCount} similar validation deck names).`);
  }

  if (syntheticName && row.totalCards === 0) {
    reasons.push("Deck is empty, consistent with an aborted automated validation run.");
  }

  if (syntheticName && isLowCardPartialDeck(row) && clusterCount >= 3) {
    reasons.push(`Low-card partial import (${row.totalCards} cards) created inside an automated validation timing cluster.`);
  }

  if (syntheticName && clusterCount >= 3) {
    reasons.push(`Created inside a clustered validation burst for the same owner (${clusterCount} suspicious decks within 10 minutes).`);
  }

  if (syntheticName && row.totalCards >= 95) {
    reasons.push("Looks like a full-size validation clone rather than a user-facing deck name.");
  }

  return reasons;
}

const candidates = rows
  .map((row) => ({
    ...row,
    clusterCount: clusteredValidationCount(row),
    duplicateCount: duplicateValidationCount(row),
    reasons: buildReasons(row)
  }))
  .filter((row) => looksSyntheticByName(row.name) && row.reasons.length >= 2);

const observedButNotFlagged = rows
  .filter((row) => !candidates.some((candidate) => candidate.id === row.id))
  .filter((row) => isLowCardPartialDeck(row))
  .map((row) => ({
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.email,
    totalCards: row.totalCards,
    createdAt: row.createdAt,
    note: "Partial deck observed, but not flagged because it lacks strong synthetic naming/timing evidence."
  }));

const candidateIds = candidates.map((candidate) => candidate.id);
const dryRunCommand = candidateIds.length > 0
  ? `node scripts/delete-decks-by-id.mjs ${candidateIds.join(" ")}`
  : null;
const executeCommand = candidateIds.length > 0
  ? `${dryRunCommand} --execute`
  : null;

console.log(JSON.stringify({
  dbPath,
  highConfidenceRule: "Candidates require obvious validation naming plus at least one secondary signal (duplicate validation naming, clustered timing, empty-run shape, low-card clustered partial import, or full-size validation-clone shape).",
  candidateCount: candidates.length,
  candidates: candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    ownerUserId: candidate.ownerUserId,
    ownerEmail: candidate.email,
    cardRows: candidate.cardRows,
    totalCards: candidate.totalCards,
    createdAt: candidate.createdAt,
    clusterCount: candidate.clusterCount,
    duplicateNameCount: candidate.duplicateCount,
    reasons: candidate.reasons
  })),
  observedButNotFlagged,
  safeCleanup: {
    dryRunCommand,
    executeCommand,
    note: "Deletion is always explicit. Review the dry run first, then add --execute only after manual confirmation."
  }
}, null, 2));
