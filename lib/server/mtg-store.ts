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
  authProvider: "local" | "google";
  googleSubject: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  preferredDisplayCurrency: "USD" | "EUR";
  showPriceFreshness: boolean;
};

type RawStoredUser = {
  createdAt?: string;
  email?: string;
  id?: number;
  isBootstrapLegacyOwner?: number | boolean;
  passwordHash?: string;
  authProvider?: string;
  googleSubject?: string | null;
  emailVerified?: number | boolean;
  emailVerifiedAt?: string | null;
  preferredDisplayCurrency?: string;
  showPriceFreshness?: number | boolean;
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

export type StoredWishlistItem = {
  id: number;
  ownerUserId: number;
  deckId: number;
  cardName: string;
  scryfallId: string | null;
  resolvedIdentityKey: string;
  targetQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredWishlistPricePoint = {
  id: number;
  resolvedIdentityKey: string;
  scryfallId: string | null;
  cardName: string;
  capturedDay: string;
  capturedAt: string;
  priceUsd: number;
  source: "cache" | "live-current";
};

export type StoredDeckCardPurchase = {
  id: number;
  ownerUserId: number;
  deckId: number;
  wishlistItemId: number | null;
  resolvedIdentityKey: string;
  cardName: string;
  scryfallId: string | null;
  quantity: number;
  unitPriceUsd: number;
  purchasedAt: string;
  createdAt: string;
};

export type DatabaseShape = {
  cards: StoredCard[];
  cardValueSnapshots: StoredCardValueSnapshot[];
  deckCardPurchases: StoredDeckCardPurchase[];
  decks: StoredDeck[];
  deckValueSnapshots: StoredDeckValueSnapshot[];
  nextCardId: number;
  nextDeckCardPurchaseId: number;
  nextCardValueSnapshotId: number;
  nextDeckId: number;
  nextDeckValueSnapshotId: number;
  nextWishlistItemId: number;
  nextWishlistPricePointId: number;
  nextUserId: number;
  sessions: StoredSession[];
  users: StoredUser[];
  wishlistItems: StoredWishlistItem[];
  wishlistPriceHistory: StoredWishlistPricePoint[];
};

type JsonDatabaseShape = Partial<DatabaseShape>;

const DATA_DIR = path.join(process.cwd(), ".data");
const DEFAULT_DB_FILE = path.join(DATA_DIR, "mtgdeckmanager-next.sqlite");
const LEGACY_JSON_FILE = path.join(DATA_DIR, "mtgdeckmanager-next.json");
const rawDatabasePath = process.env.MTG_DB_PATH?.trim();
const DATABASE_URL = rawDatabasePath && rawDatabasePath.length > 0
  ? path.resolve(process.cwd(), rawDatabasePath)
  : DEFAULT_DB_FILE;

let database: Database.Database | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function ensureDataDir() {
  try {
    mkdirSync(path.dirname(DATABASE_URL), { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Cannot create database directory for MTG_DB_PATH (${DATABASE_URL}): ${message}`);
  }
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

  if (!hasColumn(db, "users", "preferred_display_currency")) {
    db.exec("ALTER TABLE users ADD COLUMN preferred_display_currency TEXT NOT NULL DEFAULT 'USD'");
  }

  if (!hasColumn(db, "users", "show_price_freshness")) {
    db.exec("ALTER TABLE users ADD COLUMN show_price_freshness INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasColumn(db, "users", "auth_provider")) {
    db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'");
  }

  if (!hasColumn(db, "users", "google_subject")) {
    db.exec("ALTER TABLE users ADD COLUMN google_subject TEXT");
  }

  if (!hasColumn(db, "users", "email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  }

  if (!hasColumn(db, "users", "email_verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_subject ON users(google_subject)");
}

function normalizeStoredUser(raw: RawStoredUser): StoredUser {
  const createdAt = String(raw.createdAt ?? new Date().toISOString());
  const authProvider = raw.authProvider === "google" ? "google" : "local";
  const emailVerified = raw.emailVerified === true || raw.emailVerified === 1 || authProvider === "google";
  const emailVerifiedAt = raw.emailVerifiedAt == null
    ? (emailVerified ? createdAt : null)
    : String(raw.emailVerifiedAt);
  return {
    id: Number(raw.id ?? 0),
    email: String(raw.email ?? "").trim(),
    passwordHash: String(raw.passwordHash ?? ""),
    createdAt,
    isBootstrapLegacyOwner: raw.isBootstrapLegacyOwner === true || raw.isBootstrapLegacyOwner === 1,
    authProvider,
    googleSubject: raw.googleSubject == null ? null : String(raw.googleSubject),
    emailVerified,
    emailVerifiedAt,
    preferredDisplayCurrency: raw.preferredDisplayCurrency === "EUR" ? "EUR" : "USD",
    showPriceFreshness: raw.showPriceFreshness === false || raw.showPriceFreshness === 0 ? false : true
  };
}

function readMetaNumber(
  db: Database.Database,
  key:
    | "nextDeckId"
    | "nextCardId"
    | "nextUserId"
    | "nextDeckValueSnapshotId"
    | "nextCardValueSnapshotId"
    | "nextWishlistItemId"
    | "nextWishlistPricePointId"
    | "nextDeckCardPurchaseId"
) {
  const value = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value?: string } | undefined;
  const parsed = Number(value?.value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function writeMetaNumber(
  db: Database.Database,
  key:
    | "nextDeckId"
    | "nextCardId"
    | "nextUserId"
    | "nextDeckValueSnapshotId"
    | "nextCardValueSnapshotId"
    | "nextWishlistItemId"
    | "nextWishlistPricePointId"
    | "nextDeckCardPurchaseId",
  value: number
) {
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
    INSERT INTO users (
      id, email, password_hash, created_at, is_bootstrap_legacy_owner,
      auth_provider, google_subject, email_verified, email_verified_at,
      preferred_display_currency, show_price_freshness
    )
    VALUES (?, ?, ?, ?, 1, 'local', NULL, 1, ?, 'USD', 1)
  `).run(nextUserId, BOOTSTRAP_LEGACY_OWNER_EMAIL, BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH, createdAt, createdAt);

  writeMetaNumber(db, "nextUserId", nextUserId + 1);

  return {
    id: nextUserId,
    email: BOOTSTRAP_LEGACY_OWNER_EMAIL,
    passwordHash: BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH,
    createdAt,
    isBootstrapLegacyOwner: true,
    authProvider: "local",
    googleSubject: null,
    emailVerified: true,
    emailVerifiedAt: createdAt,
    preferredDisplayCurrency: "USD",
    showPriceFreshness: true
  } satisfies StoredUser;
}

function ensureBootstrapLegacyOwner(db: Database.Database) {
  const existingRaw = db.prepare(`
    SELECT
      id,
      email,
      password_hash AS passwordHash,
      created_at AS createdAt,
      is_bootstrap_legacy_owner AS isBootstrapLegacyOwner,
      auth_provider AS authProvider,
      google_subject AS googleSubject,
      email_verified AS emailVerified,
      email_verified_at AS emailVerifiedAt,
      preferred_display_currency AS preferredDisplayCurrency,
      show_price_freshness AS showPriceFreshness
    FROM users
    WHERE email = ?
    LIMIT 1
  `).get(BOOTSTRAP_LEGACY_OWNER_EMAIL) as RawStoredUser | undefined;
  const existing = existingRaw ? normalizeStoredUser(existingRaw) : undefined;

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
  try {
    database = new Database(DATABASE_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to open SQLite database at MTG_DB_PATH (${DATABASE_URL}): ${message}`);
  }
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_bootstrap_legacy_owner INTEGER NOT NULL DEFAULT 0,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      google_subject TEXT UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,
      preferred_display_currency TEXT NOT NULL DEFAULT 'USD',
      show_price_freshness INTEGER NOT NULL DEFAULT 1
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

    CREATE TABLE IF NOT EXISTS wishlist_items (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      card_name TEXT NOT NULL,
      scryfall_id TEXT,
      resolved_identity_key TEXT NOT NULL,
      target_quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE,
      UNIQUE(deck_id, resolved_identity_key)
    );

    CREATE TABLE IF NOT EXISTS wishlist_price_history (
      id INTEGER PRIMARY KEY,
      resolved_identity_key TEXT NOT NULL,
      scryfall_id TEXT,
      card_name TEXT NOT NULL,
      captured_day TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      price_usd REAL NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(resolved_identity_key, captured_day)
    );

    CREATE TABLE IF NOT EXISTS deck_card_purchases (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      wishlist_item_id INTEGER,
      resolved_identity_key TEXT NOT NULL,
      card_name TEXT NOT NULL,
      scryfall_id TEXT,
      quantity INTEGER NOT NULL,
      unit_price_usd REAL NOT NULL,
      purchased_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE,
      FOREIGN KEY(wishlist_item_id) REFERENCES wishlist_items(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wishlist_items_deck_id ON wishlist_items(deck_id);
    CREATE INDEX IF NOT EXISTS idx_wishlist_price_history_identity ON wishlist_price_history(resolved_identity_key, captured_at);
    CREATE INDEX IF NOT EXISTS idx_deck_card_purchases_deck_identity ON deck_card_purchases(deck_id, resolved_identity_key, purchased_at);

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

    const normalizedUsers: StoredUser[] = users.map((user) => ({
      id: Number(user.id),
      email: String(user.email ?? ""),
      passwordHash: String((user as Partial<StoredUser>).passwordHash ?? ""),
      createdAt: String(user.createdAt ?? new Date().toISOString()),
      isBootstrapLegacyOwner: Boolean((user as Partial<StoredUser>).isBootstrapLegacyOwner ?? false),
      authProvider: (user as Partial<StoredUser>).authProvider === "google" ? "google" : "local",
      googleSubject: (user as Partial<StoredUser>).googleSubject ?? null,
      emailVerified: Boolean((user as Partial<StoredUser>).emailVerified ?? false),
      emailVerifiedAt: (user as Partial<StoredUser>).emailVerifiedAt ?? null,
      preferredDisplayCurrency: (user as Partial<StoredUser>).preferredDisplayCurrency === "EUR" ? "EUR" : "USD",
      showPriceFreshness: Boolean((user as Partial<StoredUser>).showPriceFreshness ?? true)
    }));

    const bootstrapUser: StoredUser = normalizedUsers.find((user) => user.email === BOOTSTRAP_LEGACY_OWNER_EMAIL)
      ?? {
        id: normalizedUsers.reduce((max, user) => Math.max(max, Number(user.id ?? 0)), 0) + 1,
        email: BOOTSTRAP_LEGACY_OWNER_EMAIL,
        passwordHash: BOOTSTRAP_LEGACY_OWNER_PASSWORD_HASH,
        createdAt: new Date().toISOString(),
        isBootstrapLegacyOwner: true,
        authProvider: "local",
        googleSubject: null,
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        preferredDisplayCurrency: "USD",
        showPriceFreshness: true
      };

    const mergedUsers: StoredUser[] = normalizedUsers.some((user) => user.email === BOOTSTRAP_LEGACY_OWNER_EMAIL)
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
      wishlistItems: [],
      wishlistPriceHistory: [],
      deckCardPurchases: [],
      nextDeckId: typeof parsed.nextDeckId === "number" ? parsed.nextDeckId : decks.reduce((max, deck) => Math.max(max, Number(deck.id ?? 0)), 0) + 1,
      nextCardId: typeof parsed.nextCardId === "number" ? parsed.nextCardId : cards.reduce((max, card) => Math.max(max, Number(card.id ?? 0)), 0) + 1,
      nextDeckValueSnapshotId: 1,
      nextCardValueSnapshotId: 1,
      nextWishlistItemId: 1,
      nextWishlistPricePointId: 1,
      nextDeckCardPurchaseId: 1,
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
    INSERT INTO users (
      id, email, password_hash, created_at, is_bootstrap_legacy_owner,
      auth_provider, google_subject, email_verified, email_verified_at,
      preferred_display_currency, show_price_freshness
    )
    VALUES (
      @id, @email, @passwordHash, @createdAt, @isBootstrapLegacyOwner,
      @authProvider, @googleSubject, @emailVerified, @emailVerifiedAt,
      @preferredDisplayCurrency, @showPriceFreshness
    )
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
    VALUES
      ('nextDeckId', @nextDeckId),
      ('nextCardId', @nextCardId),
      ('nextUserId', @nextUserId),
      ('nextDeckValueSnapshotId', @nextDeckValueSnapshotId),
      ('nextCardValueSnapshotId', @nextCardValueSnapshotId),
      ('nextWishlistItemId', @nextWishlistItemId),
      ('nextWishlistPricePointId', @nextWishlistPricePointId),
      ('nextDeckCardPurchaseId', @nextDeckCardPurchaseId)
  `);

  const transaction = db.transaction(() => {
    for (const user of legacy.users) {
      const normalized = normalizeStoredUser(user);
      insertUser.run({
        ...normalized,
        isBootstrapLegacyOwner: normalized.isBootstrapLegacyOwner ? 1 : 0,
        authProvider: normalized.authProvider,
        googleSubject: normalized.googleSubject,
        emailVerified: normalized.emailVerified ? 1 : 0,
        emailVerifiedAt: normalized.emailVerifiedAt,
        preferredDisplayCurrency: normalized.preferredDisplayCurrency,
        showPriceFreshness: normalized.showPriceFreshness ? 1 : 0
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
      nextCardValueSnapshotId: "1",
      nextWishlistItemId: "1",
      nextWishlistPricePointId: "1",
      nextDeckCardPurchaseId: "1"
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

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextWishlistItemId", "1");

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextWishlistPricePointId", "1");

  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run("nextDeckCardPurchaseId", "1");
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

  const usersRaw = db.prepare(`
    SELECT
      id,
      email,
      password_hash AS passwordHash,
      created_at AS createdAt,
      is_bootstrap_legacy_owner AS isBootstrapLegacyOwner,
      auth_provider AS authProvider,
      google_subject AS googleSubject,
      email_verified AS emailVerified,
      email_verified_at AS emailVerifiedAt,
      preferred_display_currency AS preferredDisplayCurrency,
      show_price_freshness AS showPriceFreshness
    FROM users
    ORDER BY id ASC
  `).all() as RawStoredUser[];
  const users = usersRaw.map(normalizeStoredUser);

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

  const wishlistItems = db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      deck_id AS deckId,
      card_name AS cardName,
      scryfall_id AS scryfallId,
      resolved_identity_key AS resolvedIdentityKey,
      target_quantity AS targetQuantity,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM wishlist_items
    ORDER BY id ASC
  `).all() as StoredWishlistItem[];

  const wishlistPriceHistory = db.prepare(`
    SELECT
      id,
      resolved_identity_key AS resolvedIdentityKey,
      scryfall_id AS scryfallId,
      card_name AS cardName,
      captured_day AS capturedDay,
      captured_at AS capturedAt,
      price_usd AS priceUsd,
      source
    FROM wishlist_price_history
    ORDER BY captured_at ASC, id ASC
  `).all() as StoredWishlistPricePoint[];

  const deckCardPurchases = db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      deck_id AS deckId,
      wishlist_item_id AS wishlistItemId,
      resolved_identity_key AS resolvedIdentityKey,
      card_name AS cardName,
      scryfall_id AS scryfallId,
      quantity,
      unit_price_usd AS unitPriceUsd,
      purchased_at AS purchasedAt,
      created_at AS createdAt
    FROM deck_card_purchases
    ORDER BY purchased_at DESC, id DESC
  `).all() as StoredDeckCardPurchase[];

  return {
    users,
    sessions,
    decks,
    cards,
    deckValueSnapshots,
    cardValueSnapshots,
    wishlistItems,
    wishlistPriceHistory,
    deckCardPurchases,
    nextDeckId: readMetaNumber(db, "nextDeckId"),
    nextCardId: readMetaNumber(db, "nextCardId"),
    nextDeckValueSnapshotId: readMetaNumber(db, "nextDeckValueSnapshotId"),
    nextCardValueSnapshotId: readMetaNumber(db, "nextCardValueSnapshotId"),
    nextWishlistItemId: readMetaNumber(db, "nextWishlistItemId"),
    nextWishlistPricePointId: readMetaNumber(db, "nextWishlistPricePointId"),
    nextDeckCardPurchaseId: readMetaNumber(db, "nextDeckCardPurchaseId"),
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
  const wishlistPointByDayKey = new Map<string, StoredWishlistPricePoint>();
  for (const point of shape.wishlistPriceHistory) {
    const dayKey = `${point.resolvedIdentityKey}::${point.capturedDay}`;
    // Last write wins for each identity/day in the in-memory shape.
    wishlistPointByDayKey.set(dayKey, point);
  }
  const normalizedWishlistPriceHistory = Array.from(wishlistPointByDayKey.values()).sort((left, right) => (
    left.capturedAt.localeCompare(right.capturedAt) || left.id - right.id
  ));

  const replaceUser = db.prepare(`
    INSERT INTO users (
      id, email, password_hash, created_at, is_bootstrap_legacy_owner,
      auth_provider, google_subject, email_verified, email_verified_at,
      preferred_display_currency, show_price_freshness
    )
    VALUES (
      @id, @email, @passwordHash, @createdAt, @isBootstrapLegacyOwner,
      @authProvider, @googleSubject, @emailVerified, @emailVerifiedAt,
      @preferredDisplayCurrency, @showPriceFreshness
    )
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

  const replaceWishlistItem = db.prepare(`
    INSERT INTO wishlist_items (
      id, owner_user_id, deck_id, card_name, scryfall_id, resolved_identity_key, target_quantity, created_at, updated_at
    ) VALUES (
      @id, @ownerUserId, @deckId, @cardName, @scryfallId, @resolvedIdentityKey, @targetQuantity, @createdAt, @updatedAt
    )
  `);

  const replaceWishlistPricePoint = db.prepare(`
    INSERT INTO wishlist_price_history (
      id, resolved_identity_key, scryfall_id, card_name, captured_day, captured_at, price_usd, source
    ) VALUES (
      @id, @resolvedIdentityKey, @scryfallId, @cardName, @capturedDay, @capturedAt, @priceUsd, @source
    )
  `);

  const replaceDeckCardPurchase = db.prepare(`
    INSERT INTO deck_card_purchases (
      id, owner_user_id, deck_id, wishlist_item_id, resolved_identity_key, card_name, scryfall_id, quantity, unit_price_usd, purchased_at, created_at
    ) VALUES (
      @id, @ownerUserId, @deckId, @wishlistItemId, @resolvedIdentityKey, @cardName, @scryfallId, @quantity, @unitPriceUsd, @purchasedAt, @createdAt
    )
  `);

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM deck_card_purchases").run();
    db.prepare("DELETE FROM wishlist_price_history").run();
    db.prepare("DELETE FROM wishlist_items").run();
    db.prepare("DELETE FROM card_value_snapshots").run();
    db.prepare("DELETE FROM deck_value_snapshots").run();
    db.prepare("DELETE FROM cards").run();
    db.prepare("DELETE FROM decks").run();
    db.prepare("DELETE FROM users").run();

    for (const user of shape.users) {
      const normalized = normalizeStoredUser(user);
      replaceUser.run({
        ...normalized,
        isBootstrapLegacyOwner: normalized.isBootstrapLegacyOwner ? 1 : 0,
        authProvider: normalized.authProvider,
        googleSubject: normalized.googleSubject,
        emailVerified: normalized.emailVerified ? 1 : 0,
        emailVerifiedAt: normalized.emailVerifiedAt,
        preferredDisplayCurrency: normalized.preferredDisplayCurrency,
        showPriceFreshness: normalized.showPriceFreshness ? 1 : 0
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

    for (const item of shape.wishlistItems) {
      replaceWishlistItem.run(item);
    }

    for (const point of normalizedWishlistPriceHistory) {
      replaceWishlistPricePoint.run(point);
    }

    for (const purchase of shape.deckCardPurchases) {
      replaceDeckCardPurchase.run(purchase);
    }

    writeMetaNumber(db, "nextDeckId", shape.nextDeckId);
    writeMetaNumber(db, "nextCardId", shape.nextCardId);
    writeMetaNumber(db, "nextDeckValueSnapshotId", shape.nextDeckValueSnapshotId);
    writeMetaNumber(db, "nextCardValueSnapshotId", shape.nextCardValueSnapshotId);
    writeMetaNumber(db, "nextWishlistItemId", shape.nextWishlistItemId);
    writeMetaNumber(db, "nextWishlistPricePointId", shape.nextWishlistPricePointId);
    writeMetaNumber(db, "nextDeckCardPurchaseId", shape.nextDeckCardPurchaseId);
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

export async function getUserByGoogleSubject(googleSubject: string) {
  const normalized = googleSubject.trim();
  if (!normalized) {
    return null;
  }
  return (await readDatabase()).users.find((user) => (user.googleSubject ?? "") === normalized) ?? null;
}

export async function createStoredUser(input: {
  email: string;
  passwordHash: string;
  isBootstrapLegacyOwner?: boolean;
  authProvider?: "local" | "google";
  googleSubject?: string | null;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
}) {
  return withDatabaseWrite((databaseShape) => {
    const createdAt = new Date().toISOString();
    const authProvider = input.authProvider === "google" ? "google" : "local";
    const emailVerified = typeof input.emailVerified === "boolean"
      ? input.emailVerified
      : authProvider === "google";
    const user: StoredUser = {
      id: databaseShape.nextUserId++,
      email: input.email.trim(),
      passwordHash: input.passwordHash,
      createdAt,
      isBootstrapLegacyOwner: input.isBootstrapLegacyOwner ?? false,
      authProvider,
      googleSubject: input.googleSubject?.trim() || null,
      emailVerified,
      emailVerifiedAt: input.emailVerifiedAt ?? (emailVerified ? createdAt : null),
      preferredDisplayCurrency: "USD",
      showPriceFreshness: true
    };

    databaseShape.users.push(user);
    return user;
  });
}

export async function updateStoredUserPricingPreferences(
  userId: number,
  input: { preferredDisplayCurrency: "USD" | "EUR"; showPriceFreshness: boolean }
) {
  return withDatabaseWrite((databaseShape) => {
    const user = databaseShape.users.find((entry) => entry.id === userId);
    if (!user) {
      return null;
    }

    user.preferredDisplayCurrency = input.preferredDisplayCurrency;
    user.showPriceFreshness = input.showPriceFreshness;
    return user;
  });
}

export async function upsertGoogleUser(input: { email: string; googleSubject: string; emailVerified: boolean }) {
  return withDatabaseWrite((databaseShape) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedSubject = input.googleSubject.trim();
    const verifiedAt = input.emailVerified ? new Date().toISOString() : null;

    const bySubject = databaseShape.users.find((user) => (user.googleSubject ?? "") === normalizedSubject);
    if (bySubject) {
      bySubject.email = normalizedEmail;
      bySubject.authProvider = "google";
      bySubject.emailVerified = input.emailVerified || bySubject.emailVerified;
      if (!bySubject.emailVerifiedAt && input.emailVerified) {
        bySubject.emailVerifiedAt = verifiedAt;
      }
      return bySubject;
    }

    const byEmail = databaseShape.users.find((user) => user.email.trim().toLowerCase() === normalizedEmail);
    if (byEmail) {
      byEmail.googleSubject = normalizedSubject;
      byEmail.emailVerified = input.emailVerified || byEmail.emailVerified;
      if (!byEmail.emailVerifiedAt && input.emailVerified) {
        byEmail.emailVerifiedAt = verifiedAt;
      }
      return byEmail;
    }

    const user: StoredUser = {
      id: databaseShape.nextUserId++,
      email: normalizedEmail,
      passwordHash: "__oauth_google__",
      createdAt: new Date().toISOString(),
      isBootstrapLegacyOwner: false,
      authProvider: "google",
      googleSubject: normalizedSubject,
      emailVerified: input.emailVerified,
      emailVerifiedAt: input.emailVerified ? verifiedAt : null,
      preferredDisplayCurrency: "USD",
      showPriceFreshness: true
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
