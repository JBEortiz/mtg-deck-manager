import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = process.env.MTG_DB_PATH?.trim() || ".data/mtgdeckmanager-next.sqlite";
const dryRun = !args.includes("--execute");
const ids = args
  .filter((arg) => /^\d+$/.test(arg))
  .map((arg) => Number.parseInt(arg, 10))
  .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index);

if (ids.length === 0) {
  console.error("Provide one or more explicit deck ids. Example: node scripts/delete-decks-by-id.mjs 6 7 8 --execute");
  process.exit(1);
}

const db = new Database(dbPath);
const tableNames = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name));
const existing = db.prepare(`
  select d.id, d.name, d.owner_user_id as ownerUserId, u.email
  from decks d
  left join users u on u.id = d.owner_user_id
  where d.id in (${ids.map(() => "?").join(",")})
  order by d.id
`).all(...ids);

if (existing.length !== ids.length) {
  console.error(JSON.stringify({
    message: "Some requested deck ids do not exist.",
    requestedIds: ids,
    foundIds: existing.map((row) => row.id)
  }, null, 2));
  process.exit(1);
}

const payload = {
  dbPath,
  dryRun,
  decks: existing
};

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const deleteCards = tableNames.has("cards") ? db.prepare("delete from cards where deck_id = ?") : null;
const deleteDeckSnapshots = tableNames.has("deck_value_snapshots") ? db.prepare("delete from deck_value_snapshots where deck_id = ?") : null;
const deleteCardSnapshots = tableNames.has("card_value_snapshots") ? db.prepare("delete from card_value_snapshots where deck_id = ?") : null;
const deleteDeck = db.prepare("delete from decks where id = ?");

const transaction = db.transaction(() => {
  for (const deck of existing) {
    deleteCardSnapshots?.run(deck.id);
    deleteDeckSnapshots?.run(deck.id);
    deleteCards?.run(deck.id);
    deleteDeck.run(deck.id);
  }
});

transaction();

console.log(JSON.stringify({
  ...payload,
  deleted: existing.length
}, null, 2));
