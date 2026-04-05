import Database from "better-sqlite3";

const dbPath = process.env.MTG_DB_PATH?.trim() || ".data/mtgdeckmanager-next.sqlite";
const db = new Database(dbPath, { readonly: true });

const SUSPECT_NAME_PATTERNS = [
  /final import retest/i,
  /final import closeout/i,
  /\binspect\b/i,
  /\bstable\b/i,
  /\butf8\b/i,
  /\bretest\b/i
];

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
  order by d.id
`).all();

function buildReasons(row) {
  const reasons = [];
  if (SUSPECT_NAME_PATTERNS.some((pattern) => pattern.test(row.name))) {
    reasons.push("Name matches obvious validation/test naming.");
  }

  if (row.totalCards === 0) {
    reasons.push("Deck is empty, consistent with aborted validation runs.");
  }

  if (row.email === "paulalo20@gmail.com" && row.createdAt >= "2026-04-05T10:31:00.000Z" && row.createdAt <= "2026-04-05T10:37:00.000Z") {
    reasons.push("Created during the clustered import-validation window on 2026-04-05.");
  }

  if (/final import retest utf8/i.test(row.name) && row.totalCards === 100) {
    reasons.push("Looks like a dedicated validation clone deck, not a user-facing deck name.");
  }

  return reasons;
}

const candidates = rows
  .map((row) => ({
    ...row,
    reasons: buildReasons(row)
  }))
  .filter((row) => row.reasons.length > 0);

console.log(JSON.stringify({
  dbPath,
  candidateCount: candidates.length,
  candidates: candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    ownerUserId: candidate.ownerUserId,
    ownerEmail: candidate.email,
    cardRows: candidate.cardRows,
    totalCards: candidate.totalCards,
    createdAt: candidate.createdAt,
    reasons: candidate.reasons
  }))
}, null, 2));
