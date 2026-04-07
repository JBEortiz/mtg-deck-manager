import Database from "better-sqlite3";

const dbPath = process.env.MTG_DB_PATH?.trim() || ".data/mtgdeckmanager-next.sqlite";
const db = new Database(dbPath, { readonly: true });

function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolvedIdentityKey(cardName, scryfallId) {
  const id = normalize(scryfallId);
  if (id) {
    return `id:${id}`;
  }
  return `name:${normalize(cardName)}`;
}

const wishlistItems = db.prepare(`
  select id, owner_user_id as ownerUserId, deck_id as deckId, card_name as cardName, scryfall_id as scryfallId, resolved_identity_key as resolvedIdentityKey
  from wishlist_items
`).all();

const purchases = db.prepare(`
  select id, owner_user_id as ownerUserId, deck_id as deckId, card_name as cardName, scryfall_id as scryfallId, resolved_identity_key as resolvedIdentityKey
  from deck_card_purchases
`).all();

const cards = db.prepare(`
  select id, deck_id as deckId, name as cardName, scryfall_id as scryfallId
  from cards
`).all();

const historyPoints = db.prepare(`
  select resolved_identity_key as resolvedIdentityKey, card_name as cardName, scryfall_id as scryfallId, captured_at as capturedAt
  from wishlist_price_history
`).all();

const latestCurrentSnapshots = db.prepare(`
  select id, deck_id as deckId, snapshot_at as snapshotAt
  from deck_value_snapshots
  where snapshot_kind = 'current'
  order by deck_id asc, snapshot_at desc, id desc
`).all();

const latestCurrentByDeck = new Map();
for (const snapshot of latestCurrentSnapshots) {
  if (!latestCurrentByDeck.has(snapshot.deckId)) {
    latestCurrentByDeck.set(snapshot.deckId, snapshot);
  }
}

const currentCardSnapshotRows = db.prepare(`
  select deck_snapshot_id as deckSnapshotId, card_id as cardId, card_name as cardName, scryfall_id as scryfallId, unit_price as unitPrice
  from card_value_snapshots
`).all();

const pricedCardSnapshotKeys = new Set();
for (const row of currentCardSnapshotRows) {
  if (row.unitPrice == null) {
    continue;
  }
  const key = `${row.deckSnapshotId}:${row.cardId}`;
  pricedCardSnapshotKeys.add(key);
}

const latestByIdentity = new Map();
const latestByScryfall = new Map();
const latestByName = new Map();

for (const point of historyPoints) {
  const capturedAt = Date.parse(point.capturedAt);
  if (!Number.isFinite(capturedAt)) {
    continue;
  }
  const idKey = normalize(point.resolvedIdentityKey);
  const scryfallKey = normalize(point.scryfallId);
  const nameKey = normalize(point.cardName);

  const setLatest = (map, key) => {
    if (!key) {
      return;
    }
    const existing = map.get(key);
    if (!existing || capturedAt > existing.capturedAt) {
      map.set(key, { capturedAt, point });
    }
  };

  setLatest(latestByIdentity, idKey);
  setLatest(latestByScryfall, scryfallKey);
  setLatest(latestByName, nameKey);
}

function hasHistoryCoverage(target) {
  const identity = normalize(target.resolvedIdentityKey) || resolvedIdentityKey(target.cardName, target.scryfallId);
  const scryfall = normalize(target.scryfallId);
  const name = normalize(target.cardName);
  return Boolean(
    latestByIdentity.get(identity)
    || (scryfall ? latestByScryfall.get(scryfall) : null)
    || (name ? latestByName.get(name) : null)
  );
}

function summarizeTargets(targets, extraCoverageFn = null) {
  const summary = {
    total: targets.length,
    withScryfallId: 0,
    withCoverage: 0,
    withoutCoverage: 0,
    reasons: {
      no_scryfall_id: 0,
      no_local_history: 0
    },
    samples: []
  };

  for (const target of targets) {
    const hasScryfallId = Boolean(normalize(target.scryfallId));
    const hasHistory = hasHistoryCoverage(target);
    const hasExtraCoverage = extraCoverageFn ? extraCoverageFn(target) : false;
    const covered = hasHistory || hasExtraCoverage;

    if (hasScryfallId) {
      summary.withScryfallId += 1;
    }
    if (covered) {
      summary.withCoverage += 1;
      continue;
    }

    summary.withoutCoverage += 1;
    if (!hasScryfallId) {
      summary.reasons.no_scryfall_id += 1;
    }
    summary.reasons.no_local_history += 1;
    if (summary.samples.length < 10) {
      summary.samples.push({
        cardName: target.cardName,
        scryfallId: target.scryfallId ?? null,
        resolvedIdentityKey: target.resolvedIdentityKey ?? resolvedIdentityKey(target.cardName, target.scryfallId)
      });
    }
  }

  summary.coverageRate = summary.total > 0 ? Number(((summary.withCoverage / summary.total) * 100).toFixed(1)) : 100;
  return summary;
}

const deckCardCoverage = summarizeTargets(cards, (card) => {
  const latestCurrent = latestCurrentByDeck.get(card.deckId);
  if (!latestCurrent) {
    return false;
  }
  return pricedCardSnapshotKeys.has(`${latestCurrent.id}:${card.id}`);
});

const wishlistCoverage = summarizeTargets(wishlistItems);
const purchaseCoverage = summarizeTargets(purchases);

console.log(JSON.stringify({
  dbPath,
  generatedAt: new Date().toISOString(),
  note: "Coverage checks use local cache/history and latest deck current snapshots only (no live fetch).",
  coverage: {
    wishlist: wishlistCoverage,
    purchases: purchaseCoverage,
    deckCards: deckCardCoverage
  }
}, null, 2));
