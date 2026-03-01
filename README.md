# Coopah Session Intelligence (MVP)

Mobile-first performance intelligence: goal setting, Coopah screenshot parsing, Strava integration, session scoring, and fitness state.

## Stack

- **Backend**: Node.js, Express, TypeScript, SQLite (Drizzle)
- **Frontend**: React, TypeScript, Vite
- **Single user**, dark mode only

## Setup

```bash
# Install dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Create DB and run migrations (from repo root)
cd server && npm run db:migrate && cd ..

# Strava (Phase 2): create an app at https://www.strava.com/settings/api
# Set "Authorization Callback Domain" to localhost (or 127.0.0.1)
# Copy server/.env.example to server/.env and set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET

# Dev: run backend and frontend (run in your terminal)
npm run dev
```

- API: http://localhost:3001  
- App: http://localhost:5173 (proxies `/api` to backend)

If `npm run dev` hits permission errors in a sandbox, run the server and client in two terminals: `npm run dev:server` and `npm run dev:client`.

## Phase 1 — Goal feature

- **GET /api/goal** — current goal (null if none)
- **PUT /api/goal** — create/replace goal. Body: `{ raceName, distance, goalTime "HH:MM:SS", raceDate "YYYY-MM-DD" }`

Set a race goal in the UI; the rest of the app is blocked until a goal exists.
