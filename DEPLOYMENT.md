# First Production Deployment Guide

This guide prepares the root Next.js app for an initial hosted release.

## 1. Required Environment Variables

- `MTG_DB_PATH` (required)
  - Absolute or relative file path to the SQLite database.
  - Must point to a writable, persistent location in your host.
  - Example: `/var/lib/mtgdeckmanager/mtgdeckmanager-next.sqlite`

## 2. Optional Environment Variables

- `NEXT_PUBLIC_API_BASE_URL` (optional, default `/api`)
  - Use `/api` when frontend and API are served from the same Next.js app.
  - Use an absolute `https://...` URL only for split-host deployments.
- `NEXT_PUBLIC_USD_TO_EUR` (optional, default `0.92`)
  - Cached FX rate for UI display conversion only.
  - Canonical stored pricing and calculations remain USD.
- Google auth (optional, required only if enabling Google sign-in):
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI` (optional, defaults to `<origin>/api/auth/google/callback`)
  - `APP_BASE_URL` (optional, recommended when behind proxies/load balancers)
  - Compatible aliases:
    - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
    - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
  - Register callback URL in Google Cloud:
    - `https://<your-domain>/api/auth/google/callback`

## 3. Database Setup Expectations

- The app creates schema/tables automatically on first boot.
- The directory containing `MTG_DB_PATH` must be writable by the app process.
- SQLite WAL mode is enabled automatically for better concurrency.
- Do not store the DB in ephemeral filesystem paths unless data loss is acceptable.

## 4. Build and Run Commands

```bash
npm run build
npm run start
```

Optional production smoke command (PowerShell):

```powershell
$env:MTG_DB_PATH='C:\deploy-data\mtgdeckmanager-next.sqlite'; npm run build; npm run start
```

Default listen port:
- `3000` (override with `PORT` if needed by host/platform)

## 5. First Deploy Checklist

1. Set `MTG_DB_PATH` to a persistent writable path.
2. (Optional) Set `NEXT_PUBLIC_API_BASE_URL` (`/api` recommended).
3. Run `npm run build` in CI or build pipeline.
4. Start app with `npm run start`.
5. Verify `GET /api/health` returns `ok`.
6. Verify auth flow:
   - unauthenticated access to protected API returns `401`
   - cross-user deck access returns `404`
7. Verify core flows:
   - open deck
   - edit deck
   - add card
   - delete card
   - import deck
8. Verify collector flows:
   - deck wishlist loads
   - buy opportunities page loads
   - collector overview page loads
9. Verify malformed JSON safety on protected endpoints (should return `400`, not `500`):
   - `POST /api/decks`
   - `PUT /api/decks/{id}`
   - `POST /api/decks/{id}/cards`
   - `PUT /api/decks/{id}/cards/{cardId}`
   - `POST /api/decks/{id}/import`

## 6. Safety Notes

- Keep backups/snapshots of the SQLite file for recovery.
- Keep `NODE_ENV=production` in hosted environments (secure auth cookie behavior).
- If startup fails, first validate:
  - DB path exists or parent directory can be created
  - process has write permissions to DB directory
