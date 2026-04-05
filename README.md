# MTG Deck Manager

Single-app Next.js project for browsing MTG decks, viewing deck analytics, importing/exporting decklists, and using Scryfall-backed card lookup.

## Final Architecture

- Root app: Next.js App Router
- UI: React inside the root Next.js app
- Backend: Next.js Route Handlers under `app/api`
- Local persistence: SQLite file under `.data/` at runtime
- External dependency: Scryfall API for autocomplete, card lookup, and search

There is no separate Spring Boot or Vite application anymore.

## Requirements

- Node.js
- npm

## Install

```powershell
cd C:\workspace\mtg-deck-manager
npm.cmd install
```

## Run Locally

Development:

```powershell
cd C:\workspace\mtg-deck-manager
npm.cmd run dev
```

Production-style:

```powershell
cd C:\workspace\mtg-deck-manager
npm.cmd run build
npm.cmd run start
```

Default app URL:
- `http://localhost:3000`

## Environment Variables

Optional:
- `NEXT_PUBLIC_API_BASE_URL`
  Use only if you intentionally want the browser client helpers to target a non-default API base.
  Default: `/api`
- `MTG_DB_PATH`
  Optional path for the SQLite database file used by the root Next.js app.
  Default: `.data/mtgdeckmanager-next.sqlite`

No Spring-specific environment variables are required.

## Project Structure

```text
.
├── app/
├── components/
├── lib/
├── .gitignore
├── AGENTS.md
├── next-env.d.ts
├── next.config.ts
├── package.json
├── package-lock.json
├── README.md
└── tsconfig.json
```

## Main Routes

Pages:
- `/`
- `/decks`
- `/decks/[id]`
- `/assistant`

API:
- `GET /api/health`
- `GET /api/decks`
- `POST /api/decks`
- `GET /api/decks/{id}`
- `PUT /api/decks/{id}`
- `GET /api/decks/{id}/cards`
- `POST /api/decks/{id}/cards`
- `PUT /api/decks/{id}/cards/{cardId}`
- `DELETE /api/decks/{id}/cards/{cardId}`
- `GET /api/decks/{id}/stats`
- `GET /api/decks/{id}/passport`
- `GET /api/decks/{id}/mulligan-sample`
- `POST /api/decks/{id}/import`
- `GET /api/decks/{id}/export`
- `GET /api/scryfall/autocomplete`
- `GET /api/scryfall/card`
- `GET /api/scryfall/search`

## Local Data

- Runtime deck/card data is stored in `.data/mtgdeckmanager-next.sqlite`
- The persistence layer now also stores users, sessions, and deck ownership metadata
- Existing pre-auth decks are migrated deterministically to a bootstrap legacy owner:
  - email: `legacy-owner@local.mtg-deck-manager.bootstrap`
  - purpose: preserve old local decks until real user auth flows are implemented
- `.data/` is local runtime state and should not be committed

## Known Limitations

- Scryfall-backed routes depend on outbound network access to `api.scryfall.com`
- There is no `DELETE /api/decks/{id}` route because the legacy application did not expose one
- Persistence is now SQLite-backed but still embedded/local to the app process

## Manual Smoke Test

1. Start the app with `npm.cmd run dev`
2. Open `/`
3. Create a deck
4. Open the deck detail page
5. Add a card
6. Confirm stats, passport, mulligan, and export work
7. Remove the card and confirm it disappears
8. Check `/api/health`
