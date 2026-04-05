import "server-only";

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const BOOTSTRAP_LEGACY_OWNER_EMAIL = "legacy-owner@local.mtg-deck-manager.bootstrap";
const BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH = "__bootstrap_legacy_owner__";

export type StoredUser = {
  createdAt: string;
  email: string;
  id: number;
  isBootstrapLegacyOwner: boolean;
  passwordHash: string;
};

export type StoredSession = {
  createdAt: string;
  expiresAt: string;
  id: string;
  userId: number;
};

export type StoredDeck = {
  commander: string;
  createdAt: string;
  format: string;
  id: number;
  name: string;
  ownerUserId: number;
};

export type StoredDeckValueSnapshot = {
  id: number;
  deckId: number;
  snapshotKind: "baseline" | "current";
  source: string;
  snapshotAt: string;
  currency: string;
  totalValue: number;
  pricedCardCount: number;
  missingPriceCardCount: number;
  note: string | null;
};

export type StoredCardValueSnapshot = {
  id: number;
  deckSnapshotId: number;
  deckId: number;
  cardId: number | null;
  cardName: string;
  quantity: number;
  scryfallId: string | null;
  imageUrl: string | null;
  currency: string;
  unitPrice: number | null;
  totalValue: number | null;
  status: "priced" | "missing";
};

export type StoredCard = {
  colors: string;
  deckId: number;
  id: number;
  imageNormal: string | null;
  imageSmall: string | null;
  imageUrl: string | null;
  manaValue: number;
  name: string;
  quantity: number;
  scryfallId: string | null;
  type: string;
};

export type DatabaseShape = {
  cards: StoredCard[];
  cardValueSnapshots: StoredCardValueSnapshot[];
  decks: StoredDeck[];
  deckValueSnapshots: StoredDeckValueSnapshot[];
  nextCardId: number;
  nextCardValueSnapshotId: number;
  nextDeckId: number;
  nextDeckValueSnapshotId: number;
  nextUserId: number;
  sessions: StoredSession[];
  users: StoredUser[];
};

type JsonDatabaseShape = Partial<DatabaseShape>;

const DATA_DIR = path.join(process.cwd(), ".data");
const DEFAULT_DB_FILE = path.join(DATA_DIR, "mtgdeckmanager-next.sqlite");
const LEGACY_JSON_FILE = path.join(DATA_DIR, "mtgdeckmanager-next.json");
const DATABASE_URL = process.env.MTG_DB_PATH?.trim() || DEFAULT_DB_FILE;

let database: Database.Database | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function ensureDataDir() {
  mkdirSync(path.dirname(DATABASE_URL), { recursive: true });
}

function hasColumn(db: Database.Database, tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return columns.some((column) => column.name === columnName);
}

function ensureSchemaColumns(db: Database.Database) {
  if (!hasColumn(db, "decks", "owner_user_id")) {
    db.exec("ALTER TABLE decks ADD COLUMN owner_user_id INTEGER");
  }

  if (!hasColumn(db, "users", "is_bootstrap_legacy_owner")) {
    db.exec("ALTER TABLE users ADD COLUMN is_bootstrap_legacy_owner INTEGER NOT NULL DEFAULT 0");
  }
}

function readMetaNumber(db: Database.Database, key: "nextDeckId" | "nextCardId" | "nextUserId" | "nextDeckValueSnapshotId" | "nextCardValueSnapshotId") {
  const value = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value?: string } | undefined;
  const parsed = Number(value?.value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function writeMetaNumber(db: Database.Database, key: "nextDeckId" | "nextCardId" | "nextUserId" | "nextDeckValueSnapshotId" | "nextCardValueSnapshotId", value: number) {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function createBootstrapLegacyOwner(db: Database.Database) {
  const nextUserId = readMetaNumber(db, "nextUserId");
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, is_bootstrap_legacy_owner)
    VALUES (?, ?, ?, ?, 1)
  `).run(nextUserId, BOOTSTRAP_LEGACY_OWNER_EMAIL, BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH, createdAt);

  writeMetaNumber(db, "nextUserId", nextUserId + 1);

  return {
    id: nextUserId,
    email: BOOTSTRAP_LEGACY_OWNER_EMAIL,
    passwordHash: BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH,
    createdAt,
    isBootstrapLegacyOwner: true
  } satisfies StoredUser;
}

function ensureBootstrapLegacyOwner(db: Database.Database) {
  const existing = db.prepare(`
    SELECT
      id,
      email,
      password_hash AS passwordHash,
      created_at AS createdAt,
      is_bootstrap_legacy_owner AS isBootstrapLegacyOwner
    FROM users
    WHERE email = ?
    LIMIT 1
  `).get(BOOTSTRAP_LEGACY_OWNER_EMAIL) as StoredUser | undefined;

  if (existing) {
    if (!existing.isBootstrapLegacyOwner) {
      db.prepare(`
        UPDATE users
        SET is_bootstrap_legacy_owner = 1
        WHERE id = ?
      `).run(existing.id);
      existing.isBootstrapLegacyOwner = true;
    }
    return existing;
  }

  return createBootstrapLegacyOwner(db);
}

function openDatabase() {
  if (database) {
    return database;
  }

  ensureDataDir();
  database = new Database(DATABASE_URL);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_bootstrap_legacy_owner INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      commander TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY,
      deck_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mana_value INTEGER NOT NULL,
      type TEXT NOT NULL,
      colors TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      scryfall_id TEXT,
      image_small TEXT,
      image_normal TEXT,
      image_url TEXT,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deck_value_snapshots (
      id INTEGER PRIMARY KEY,
      deck_id INTEGER NOT NULL,
      snapshot_kind TEXT NOT NULL,
      source TEXT NOT NULL,
      snapshot_at TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_value REAL NOT NULL,
      priced_card_count INTEGER NOT NULL DEFAULT 0,
      missing_price_card_count INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS card_value_snapshots (
      id INTEGER PRIMARY KEY,
      deck_snapshot_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      card_id INTEGER,
      card_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      scryfall_id TEXT,
      image_url TEXT,
      currency TEXT NOT NULL,
      unit_price REAL,
      total_value REAL,
      status TEXT NOT NULL,
      FOREIGN KEY(deck_snapshot_id) REFERENCES deck_value_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  ensureSchemaColumns(database);
  seedMetaIfMissing(database);
  migrateLegacyJsonIfNeeded(database);
  migrateExistingDeckOwnership(database);
  return database;
}

function readLegacyJson(): DatabaseShape | null {
  if (!existsSync(LEGACY_JSON_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(LEGACY_JSON_FILE, "utf8");
    const parsed = JSON.parse(raw) as JsonDatabaseShape;
    const decks = Array.isArray(parsed.decks) ? parsed.decks : [];
    const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];

    const normalizedUsers = users.map((user) => ({
      id: Number(user.id),
      email: String(user.email ?? ""),
      passwordHash: String((user as Partial<StoredUser>).passwordHash ?? ""),
      createdAt: String(user.createdAt ?? new Date().toISOString()),
      isBootstrapLegacyOwner: Boolean((user as Partial<StoredUser>).isBootstrapLegacyOwner ?? false)
    }));

    const bootstrapUser = normalizedUsers.find((user) => user.email === BOOTSTRAP_LEGACY_OWNER_EMAIL)
      ?? {
        id: normalizedUsers.reduce((max, user) => Math.max(max, Number(user.id ?? 0)), 0) + 1,
        email: BOOTSTRAP_LEGACY_OWNER_EMAIL,
        passwordHash: BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH,
        createdAt: new Date().toISOString(),
        isBootstrapLegacyOwner: true
      };

    const mergedUsers = normalizedUsers.some((user) => user.email === BOOTSTRAP_LEGACY_OWNER_EMAIL)
      ? normalizedUsers.map((user) => user.email === BOOTSTRAP_LEGACY_OWNER_EMAIL ? { ...user, isBootstrapLegacyOwner: true } : user)
      : [...normalizedUsers, bootstrapUser];

    return {
      users: mergedUsers,
      sessions: sessions.map((session) => ({
        id: String(session.id ?? ""),
        userId: Number((session as Partial<StoredSession>).userId ?? 0),
        createdAt: String(session.createdAt ?? new Date().toISOString()),
        expiresAt: String((session as Partial<StoredSession>).expiresAt ?? new Date().toISOString())
      })).filter((session) => session.id && session.userId > 0),
      decks: decks.map((deck) => ({
        id: Number(deck.id),
        ownerUserId: Number((deck as Partial<StoredDeck>).ownerUserId ?? bootstrapUser.id),
        name: String(deck.name ?? ""),
        format: String(deck.format ?? ""),
        commander: String(deck.commander ?? ""),
        createdAt: String(deck.createdAt ?? new Date().toISOString())
      })),
      cards: cards.map((card) => ({
        id: Number(card.id),
        deckId: Number(card.deckId),
        name: String(card.name ?? ""),
        manaValue: Number(card.manaValue ?? 0),
        type: String(card.type ?? ""),
        colors: String(card.colors ?? ""),
        quantity: Number(card.quantity ?? 1),
        scryfallId: card.scryfallId == null ? null : String(card.scryfallId),
        imageSmall: card.imageSmall == null ? null : String(card.imageSmall),
        imageNormal: card.imageNormal == null ? null : String(card.imageNormal),
        imageUrl: card.imageUrl == null ? null : String(card.imageUrl)
      })),
      deckValueSnapshots: [],
      cardValueSnapshots: [],
      nextDeckId: typeof parsed.nextDeckId === "number" ? parsed.nextDeckId : decks.reduce((max, deck) => Math.max(max, Number(deck.id ?? 0)), 0) + 1,
      nextCardId: typeof parsed.nextCardId === "number" ? parsed.nextCardId : cards.reduce((max, card) => Math.max(max, Number(card.id ?? 0)), 0) + 1,
      nextDeckValueSnapshotId: 1,
      nextCardValueSnapshotId: 1,
      nextUserId: typeof parsed.nextUserId === "number" ? parsed.nextUserId : mergedUsers.reduce((max, user) => Math.max(max, Number(user.id ?? 0)), 0) + 1
    };
  } catch {
    return null;
  }
}

function migrateLegacyJsonIfNeeded(db: Database.Database) {
  const deckCount = Number((db.prepare("SELECT COUNT(*) AS count FROM decks").get() as { count?: number } | undefined)?.count ?? 0);
  const cardCount = Number((db.prepare("SELECT COUNT(*) AS count FROM cards").get() as { count?: number } | undefined)?.count ?? 0);
  const deckValueSnapshotCount = Number((db.prepare("SELECT COUNT(*) AS count FROM deck_value_snapshots").get() as { count?: number } | undefined)?.count ?? 0);
  const cardValueSnapshotCount = Number((db.prepare("SELECT COUNT(*) AS count FROM card_value_snapshots").get() as { count?: number } | undefined)?.count ?? 0);
  const userCount = Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count?: number } | undefined)?.count ?? 0);
  const sessionCount = Number((db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count?: number } | undefined)?.count ?? 0);
  const metaCount = Number((db.prepare("SELECT COUNT(*) AS count FROM app_meta").get() as { count?: number } | undefined)?.count ?? 0);

  if (deckCount > 0 || cardCount > 0 || deckValueSnapshotCount > 0 || cardValueSnapshotCount > 0 || userCount > 0 || sessionCount > 0 || metaCount > 0) {
    return;
  }

  const legacy = readLegacyJson();
  if (!legacy) {
    return;
  }

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, is_bootstrap_legacy_owner)
    VALUES (@id, @email, @passwordHash, @createdAt, @isBootstrapLegacyOwner)
  `);

  const insertSession = db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at)
    VALUES (@id, @userId, @createdAt, @expiresAt)
  `);

  const insertDeck = db.prepare(`
    INSERT INTO decks (id, owner_user_id, name, format, commander, created_at)
    VALUES (@id, @ownerUserId, @name, @format, @commander, @createdAt)
  `);

  const insertCard = db.prepare(`
    INSERT INTO cards (
      id, deck_id, name, mana_value, type, colors, quantity, scryfall_id, image_small, image_normal, image_url
    ) VALUES (
      @id, @deckId, @name, @manaValue, @type, @colors, @quantity, @scryfallId, @imageSmall, @imageNormal, @imageUrl
    )
  `);

  const seedMeta = db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES ('nextDeckId', @nextDeckId), ('nextCardId', @nextCardId), ('nextUserId', @nextUserId), ('nextDeckValueSnapshotId', @nextDeckValueSnapshotId), ('nextCardValueSnapshotId', @nextCardValueSnapshotId)
  `);

  const transaction = db.transaction(() => {
    for (const user of legacy.users) {
      insertUser.run({
        ...user,
        isBootstrapLegacyOwner: user.isBootstrapLegacyOwner ? 1 : 0
      });
    }

    for (const session of legacy.sessions) {
      insertSession.run(session);
    }

    for (const deck of legacy.decks) {
      insertDeck.run(deck);
    }

    for (const card of legacy.cards) {
      insertCard.run(card);
    }

    seedMeta.run({
      nextDeckId: String(legacy.nextDeckId),
      nextCardId: String(legacy.nextCardId),
      nextUserId: String(legacy.nextUserId),
      nextDeckValueSnapshotId: "1",
      nextCardValueSnapshotId: "1"
    });
  });

  transaction();
}

function seedMetaIfMissing(db: Database.Database) {
  const deckMax = Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM decks").get() as { maxId?: number } | undefined)?.maxId ?? 0);
  const cardMax = Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM cards").get() as { maxId?: number } | undefined)?.maxId ?? 0);
  const userMax = Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM users").get() as { maxId?: number } | undefined)?.maxId ?? 0);

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextDeckId", String(deckMax + 1));

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextCardId", String(cardMax + 1));

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextUserId", String(userMax + 1));

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextDeckValueSnapshotId", "1");

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextCardValueSnapshotId", "1");
}

function migrateExistingDeckOwnership(db: Database.Database) {
  const bootstrapOwner = ensureBootstrapLegacyOwner(db);

  db.prepare(`
    UPDATE decks
    SET owner_user_id = ?
    WHERE owner_user_id IS NULL
  `).run(bootstrapOwner.id);
}

export async function readDatabase(): Promise<DatabaseShape> {
  const db = openDatabase();

  const users = db.prepare(`
    SELECT
      id,
      email,
      password_hash AS passwordHash,
      created_at AS createdAt,
      is_bootstrap_legacy_owner AS isBootstrapLegacyOwner
    FROM users
    ORDER BY id ASC
  `).all() as StoredUser[];

  const sessions = db.prepare(`
    SELECT
      id,
      user_id AS userId,
      created_at AS createdAt,
      expires_at AS expiresAt
    FROM sessions
    ORDER BY created_at ASC
  `).all() as StoredSession[];

  const decks = db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      name,
      format,
      commander,
      created_at AS createdAt
    FROM decks
    ORDER BY id ASC
  `).all() as StoredDeck[];

  const cards = db.prepare(`
    SELECT
      id,
      deck_id AS deckId,
      name,
      mana_value AS manaValue,
      type,
      colors,
      quantity,
      scryfall_id AS scryfallId,
      image_small AS imageSmall,
      image_normal AS imageNormal,
      image_url AS imageUrl
    FROM cards
    ORDER BY id ASC
  `).all() as StoredCard[];

  const deckValueSnapshots = db.prepare(`
    SELECT
      id,
      deck_id AS deckId,
      snapshot_kind AS snapshotKind,
      source,
      snapshot_at AS snapshotAt,
      currency,
      total_value AS totalValue,
      priced_card_count AS pricedCardCount,
      missing_price_card_count AS missingPriceCardCount,
      note
    FROM deck_value_snapshots
    ORDER BY snapshot_at ASC, id ASC
  `).all() as StoredDeckValueSnapshot[];

  const cardValueSnapshots = db.prepare(`
    SELECT
      id,
      deck_snapshot_id AS deckSnapshotId,
      deck_id AS deckId,
      card_id AS cardId,
      card_name AS cardName,
      quantity,
      scryfall_id AS scryfallId,
      image_url AS imageUrl,
      currency,
      unit_price AS unitPrice,
      total_value AS totalValue,
      status
    FROM card_value_snapshots
    ORDER BY id ASC
  `).all() as StoredCardValueSnapshot[];

  return {
    users,
    sessions,
    decks,
    cards,
    deckValueSnapshots,
    cardValueSnapshots,
    nextDeckId: readMetaNumber(db, "nextDeckId"),
    nextCardId: readMetaNumber(db, "nextCardId"),
    nextDeckValueSnapshotId: readMetaNumber(db, "nextDeckValueSnapshotId"),
    nextCardValueSnapshotId: readMetaNumber(db, "nextCardValueSnapshotId"),
    nextUserId: readMetaNumber(db, "nextUserId")
  };
}

function persistDatabaseShape(db: Database.Database, shape: DatabaseShape) {
  const cardIds = new Set(shape.cards.map((card) => card.id));
  const normalizedCardValueSnapshots = shape.cardValueSnapshots.map((snapshot) => (
    snapshot.cardId != null && !cardIds.has(snapshot.cardId)
      ? {
          ...snapshot,
          cardId: null
        }
      : snapshot
  ));

  const replaceUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, is_bootstrap_legacy_owner)
    VALUES (@id, @email, @passwordHash, @createdAt, @isBootstrapLegacyOwner)
  `);

  const replaceSession = db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at)
    VALUES (@id, @userId, @createdAt, @expiresAt)
  `);

  const replaceDeck = db.prepare(`
    INSERT INTO decks (id, owner_user_id, name, format, commander, created_at)
    VALUES (@id, @ownerUserId, @name, @format, @commander, @createdAt)
  `);

  const replaceCard = db.prepare(`
    INSERT INTO cards (
      id, deck_id, name, mana_value, type, colors, quantity, scryfall_id, image_small, image_normal, image_url
    ) VALUES (
      @id, @deckId, @name, @manaValue, @type, @colors, @quantity, @scryfallId, @imageSmall, @imageNormal, @imageUrl
    )
  `);

  const replaceDeckValueSnapshot = db.prepare(`
    INSERT INTO deck_value_snapshots (
      id, deck_id, snapshot_kind, source, snapshot_at, currency, total_value, priced_card_count, missing_price_card_count, note
    ) VALUES (
      @id, @deckId, @snapshotKind, @source, @snapshotAt, @currency, @totalValue, @pricedCardCount, @missingPriceCardCount, @note
    )
  `);

  const replaceCardValueSnapshot = db.prepare(`
    INSERT INTO card_value_snapshots (
      id, deck_snapshot_id, deck_id, card_id, card_name, quantity, scryfall_id, image_url, currency, unit_price, total_value, status
    ) VALUES (
      @id, @deckSnapshotId, @deckId, @cardId, @cardName, @quantity, @scryfallId, @imageUrl, @currency, @unitPrice, @totalValue, @status
    )
  `);

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM card_value_snapshots").run();
    db.prepare("DELETE FROM deck_value_snapshots").run();
    db.prepare("DELETE FROM cards").run();
    db.prepare("DELETE FROM decks").run();
    db.prepare("DELETE FROM users").run();

    for (const user of shape.users) {
      replaceUser.run({
        ...user,
        isBootstrapLegacyOwner: user.isBootstrapLegacyOwner ? 1 : 0
      });
    }

    for (const session of shape.sessions) {
      replaceSession.run(session);
    }

    for (const deck of shape.decks) {
      replaceDeck.run(deck);
    }

    for (const card of shape.cards) {
      replaceCard.run(card);
    }

    for (const snapshot of shape.deckValueSnapshots) {
      replaceDeckValueSnapshot.run(snapshot);
    }

    for (const snapshot of normalizedCardValueSnapshots) {
      replaceCardValueSnapshot.run(snapshot);
    }

    writeMetaNumber(db, "nextDeckId", shape.nextDeckId);
    writeMetaNumber(db, "nextCardId", shape.nextCardId);
    writeMetaNumber(db, "nextDeckValueSnapshotId", shape.nextDeckValueSnapshotId);
    writeMetaNumber(db, "nextCardValueSnapshotId", shape.nextCardValueSnapshotId);
    writeMetaNumber(db, "nextUserId", shape.nextUserId);
  });

  transaction();
}

export async function withDatabaseWrite<T>(updater: (databaseShape: DatabaseShape) => Promise<T> | T): Promise<T> {
  let result!: T;

  writeQueue = writeQueue.then(async () => {
    const db = openDatabase();
    const shape = await readDatabase();
    result = await updater(shape);
    persistDatabaseShape(db, shape);
  });

  await writeQueue;
  return result;
}

export async function listUsers() {
  return (await readDatabase()).users;
}

export async function getUserById(userId: number) {
  return (await readDatabase()).users.find((user) => user.id === userId) ?? null;
}

export async function getUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return (await readDatabase()).users.find((user) => user.email.trim().toLowerCase() === normalized) ?? null;
}

export async function createStoredUser(input: { email: string; passwordHash: string; isBootstrapLegacyOwner?: boolean }) {
  return withDatabaseWrite((databaseShape) => {
    const user: StoredUser = {
      id: databaseShape.nextUserId++,
      email: input.email.trim(),
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
      isBootstrapLegacyOwner: input.isBootstrapLegacyOwner ?? false
    };

    databaseShape.users.push(user);
    return user;
  });
}

export async function listSessions() {
  return (await readDatabase()).sessions;
}

export async function getSessionById(sessionId: string) {
  return (await readDatabase()).sessions.find((session) => session.id === sessionId) ?? null;
}

export async function createStoredSession(input: { id: string; userId: number; expiresAt: string }) {
  return withDatabaseWrite((databaseShape) => {
    const session: StoredSession = {
      id: input.id,
      userId: input.userId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt
    };

    databaseShape.sessions = databaseShape.sessions.filter((entry) => entry.id !== session.id);
    databaseShape.sessions.push(session);
    return session;
  });
}

export async function deleteStoredSession(sessionId: string) {
  return withDatabaseWrite((databaseShape) => {
    databaseShape.sessions = databaseShape.sessions.filter((session) => session.id !== sessionId);
  });
}

export async function listOwnedDecks(ownerUserId: number) {
  return (await readDatabase()).decks.filter((deck) => deck.ownerUserId === ownerUserId);
}

export async function getBootstrapLegacyOwner() {
  const db = openDatabase();
  return ensureBootstrapLegacyOwner(db);
}

export function getDatabaseFilePath() {
  return DATABASE_URL;
}
