# MTG Deck Manager (Root Next.js App)

Single-app Next.js project for MTG deck management with lightweight collector-focused tooling:
- deck summary + mulligan
- deck-aware wishlist
- buy signals + local price history
- purchase tracking
- global buy opportunities and collector overview
- global MTG Rules Helper (non-personalized)

## Architecture

- App/UI/API: Next.js App Router + Route Handlers
- Persistence: local SQLite (`better-sqlite3`)
- External data: Scryfall API for card lookup/search/pricing

## Requirements

- Node.js 20+
- npm

## Install

```powershell
cd C:\workspace\mtg-deck-manager
npm.cmd install
```

## Environment

Copy `.env.example` to `.env` and set values as needed.

Required for production:
- `MTG_DB_PATH`

Optional:
- `NEXT_PUBLIC_API_BASE_URL` (default `/api`)
- `NEXT_PUBLIC_USD_TO_EUR` (default `0.92`, display conversion only)
- Google auth:
  - `GOOGLE_OAUTH_CLIENT_ID` (required for Google login)
  - `GOOGLE_OAUTH_CLIENT_SECRET` (required for Google login)
  - `GOOGLE_OAUTH_REDIRECT_URI` (optional, defaults to `<origin>/api/auth/google/callback`)
  - `APP_BASE_URL` (optional, recommended behind proxies; used as callback origin fallback)
  - Compatible aliases:
    - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
    - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`

Google callback URLs to register in Google Cloud:
- `http://localhost:3000/api/auth/google/callback` (local dev)
- `https://<your-domain>/api/auth/google/callback` (production)

If Google login sends you to `/sign-in?authError=google_unavailable`, check the `authDetail` query parameter:
- missing env vars: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- redirect URI issues: `GOOGLE_OAUTH_REDIRECT_URI_INVALID` or `GOOGLE_OAUTH_REDIRECT_URI_MISSING`
- fix flow:
  1. set required Google env vars in `.env`
  2. register callback URL in Google Cloud exactly as used by your app
  3. restart `npm run dev`

## Run

Development:

```powershell
npm.cmd run dev
```

Production-style:

```powershell
npm.cmd run build
npm.cmd run start
```

App URL by default:
- `http://localhost:3000`

## Main Pages

- `/`
- `/decks`
- `/decks/[id]`
- `/buy-opportunities`
- `/collector-overview`
- `/rules-helper`

Compatibility redirect:
- `/assistant` -> `/rules-helper`

## Health Check

- `GET /api/health`
- Returns `ok` only when the app and database are readable.

## Deployment

See [DEPLOYMENT.md](/C:/workspace/mtg-deck-manager/DEPLOYMENT.md) for first-release deployment steps and checklist.
