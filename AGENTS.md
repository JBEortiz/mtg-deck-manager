# Repository Guidelines

## Repo Structure
- `backend/`: Spring Boot API (Java 21, Maven, H2).
  - `src/main/java/com/example/mtgdeckmanager/deck`: deck and card entities, repositories, controllers.
  - `src/main/java/com/example/mtgdeckmanager/config`: CORS config.
  - `src/main/resources/application.properties`: local DB/app settings.
- `frontend/`: React + Vite + TypeScript UI (`src/App.tsx` contains deck/card flow).

## Requirements
- Java 21 for backend.
- Node.js + npm for frontend.

## Run Locally
Backend:
```powershell
cd backend
mvn spring-boot:run
```
If port `8080` is busy, use an alternate port:
```powershell
mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=8090
```

Frontend:
```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

## API Endpoints
Decks:
- `GET /api/decks`
- `POST /api/decks`
- `GET /api/decks/{id}`

Cards per deck:
- `GET /api/decks/{id}/cards`
- `POST /api/decks/{id}/cards`
- `DELETE /api/decks/{id}/cards/{cardId}`

Health:
- `GET /api/health`

## Manual Verification (Deck/Card Flow)
1. Start backend and frontend.
2. In UI, create a deck.
3. Select the deck and add a card.
4. Confirm the card appears in the deck card list.
5. Remove the card and confirm it disappears.
6. Optional API check with PowerShell:
```powershell
Invoke-RestMethod http://localhost:8080/api/decks
```
(Replace `8080` with `8090` if using alternate port.)

## Change Rules
- Prefer minimal, reversible changes.
- Avoid unrelated refactors in feature/fix work.
