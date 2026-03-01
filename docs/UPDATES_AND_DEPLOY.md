# Coopah Session Intelligence — Updates & Going Live

This doc summarises recent changes and how to run or deploy the app so you can start a new chat and put it live.

---

## Summary of recent updates

### Accounts & sharing
- **Simple accounts:** Sign up / sign in with email and password. Each account has its own goal, Strava connection, session plans, and session scores.
- **Session cookie auth:** Login and registration set an httpOnly cookie; all API calls use `credentials: 'include'`. On 401 the client shows the login screen.
- **DB:** `users` table; `user_id` on goals, strava_credentials, parsed_plans, session_scores. Migration `0007_users_and_scoping.sql` plus startup migration in `server/src/db/index.ts` ensures the `users` table exists.

### Session plans
- **Add your planned session:** Two equal options — **Add manually** (blank form: session name, coach message, intervals) and **Add screenshot** (upload Coopah PACE screenshots, then analyse and confirm).
- **Copy:** Title “Add your planned session”; subtitle explains including title, coach message, and that each rep shows time and pace.
- **Add another session:** When a plan is already saved, the same two options appear under “Plan saved (ID: …)” so you can add another session without losing the current one.
- **Plan persistence:** Confirmed plan (and `parsedPlanId`) are stored in `localStorage` per user so they survive the Strava OAuth redirect.

### Strava flow
- **Match laps first:** Only the “Match laps” button is shown initially. After matching, the “Score session” button appears in green below the matching block.
- **Re-run:** Stored sessions keep `selectedLapIds`; **Re-run** calls `POST /api/sessions/:id/reanalyse` to recompute scores with the latest analysis.

### Previous results
- **Location:** “Previous results” lives under **Current goal** (in App), not in the Strava section.
- **Component:** `client/src/PreviousResults.tsx` — fetches sessions, shows list with **session name · date · score**, plus **Re-run** and **Remove**.
- **API:** `GET /api/sessions` returns `sessionName` (join with `parsed_plans`). List ordered by session name, then date, then score.
- **Remove:** `DELETE /api/sessions/:id` deletes the session score and its fitness snapshot.

### Coach narrative
- **Deeper copy:** Coach text is more interpretive and conversational (what the session means, what to prioritise next), not just restating numbers.
- **Race goal & session:** When the user has a goal, the coach refers to the race goal and session name and says whether they’re on track (session threshold vs goal pace).

### Goal UI
- **Current goal only when set:** When a goal exists, only “Current goal” is shown with an **Edit** button. The full form appears when editing; **Cancel** returns to the current-goal view.

---

## Project structure (for new chats)

- **Root:** `package.json` — scripts: `dev`, `build`, `db:migrate`. `npm run dev` runs server + client.
- **Server:** `server/` — Express, SQLite (Drizzle), `server/data/sqlite.db`. Env: `server/.env` (see `server/.env.example`). Key: `JWT_SECRET`, `STRAVA_*` for OAuth.
- **Client:** `client/` — Vite + React. Proxies `/api` to the server in dev (see `client/vite.config.ts`).
- **Docs:** `docs/SCORING_AND_FITNESS_STATE_SPEC.md`, `PLAN.md`, this file.

---

## Running locally

1. **Env:** Copy `server/.env.example` to `server/.env` and set at least `JWT_SECRET`. For Strava: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and redirect URI (e.g. `http://localhost:5173` for dev).
2. **DB:** On first run the server applies the users migration to `server/data/sqlite.db` if the `users` table is missing. Optional: `npm run db:migrate` from root.
3. **Start:** From repo root run `npm run dev`. Client: http://localhost:5173, server: http://localhost:3001.
4. **First user:** Register with email + password (no default user login).

---

## Putting it live

### Build
- From repo root: `npm run build`. This builds `server/dist/` and `client/dist/`.

### Off-the-shelf hosting (Render or Railway)

Both are free to start; no server to manage.

**Render (easiest — one-click from GitHub)**  
1. Push this repo to GitHub.  
2. Go to [render.com](https://render.com), sign up, connect GitHub.  
3. **New → Web Service**, select this repo.  
4. Render will detect `render.yaml`. If it does, confirm:
   - **Build:** `npm install && npm run build`
   - **Start:** `npm run start`
   If there’s no Blueprint, set those manually and **Root Directory** = (leave blank).  
5. In the service **Environment** tab add:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = (use “Generate” or a long random string)
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` = from [Strava API](https://www.strava.com/settings/api)
   - After first deploy you’ll get a URL like `https://coopah-session-xxxx.onrender.com`. Then add:
     - `STRAVA_REDIRECT_URI` = `https://<that-url>/api/strava/callback`
     - `FRONTEND_ORIGIN` = `https://<that-url>`
   - (Optional) `OPENAI_API_KEY` for screenshot analysis and coach narrative.  
6. In Strava app settings set **Authorization Callback Domain** to `coopah-session-xxxx.onrender.com` (no `https://`).  
7. Deploy. Free tier may spin down after ~15 min idle; first request can be slow. **Note:** On Render free tier the filesystem is ephemeral, so SQLite data in `server/data/` is lost on redeploy; for long-term data consider a persistent disk (paid) or migrating to a hosted DB later.

**Railway**  
1. Push to GitHub. Go to [railway.app](https://railway.app), sign up, **New Project → Deploy from GitHub** and pick this repo.  
2. In the service **Settings**: **Build Command** = `npm install && npm run build`, **Start Command** = `npm run start`, **Root Directory** = (blank).  
3. Add the same env vars as Render (including `NODE_ENV=production`). Set `STRAVA_REDIRECT_URI` and `FRONTEND_ORIGIN` to your Railway URL (e.g. `https://your-app.up.railway.app`) after the first deploy.  
4. In Strava set **Authorization Callback Domain** to your Railway host (e.g. `your-app.up.railway.app`).

### Single-host deploy (generic)
The server is set up to serve the client in production:
- When `NODE_ENV=production` and `client/dist` exists, Express serves static files from `client/dist` and sends `index.html` for non-API routes.
- **Steps:**
  1. Set env: `NODE_ENV=production`, `PORT` (if your host needs it), `JWT_SECRET`, and Strava vars. In Strava app settings set **Authorization Callback Domain** to your production domain (e.g. `your-app.fly.dev`) and use:
     - `STRAVA_REDIRECT_URI=https://your-domain/api/strava/callback`
     - `FRONTEND_ORIGIN=https://your-domain`
  2. From repo root: `npm run build`.
  3. Start: `node server/dist/index.js` (or from `server/`: `npm run start`). The app is available on the same URL (API at `/api/*`, everything else is the React app).

### Option B — Separate front and back
- **Backend:** Deploy the Node server (e.g. Railway, Fly.io, Render). Set env vars; ensure `server/data/` is writable for SQLite (or switch to a hosted DB). CORS: allow the front-end origin.
- **Frontend:** Deploy `client/dist` to Vite/Netlify/Vercel/Cloudflare. Set the API base URL to the live backend (e.g. env `VITE_API_URL` and use it in `fetch()`).
- **Strava:** In Strava app settings set the production redirect URI (e.g. `https://your-app.com` or `https://your-app.com/callback`).

### Env checklist for production
- `JWT_SECRET` — strong random string.
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` — from Strava API.
- Strava redirect URI updated to production URL.
- `PORT` — if your host doesn’t set it.

---

## Quick reference — key files

| Area            | Path |
|-----------------|------|
| Auth (server)   | `server/src/routes/auth.ts`, `server/src/lib/auth.ts`, `server/src/middleware/auth.ts` |
| Goal            | `server/src/routes/goal.ts`, `client/src/GoalForm.tsx`, `client/src/GoalDisplay.tsx` |
| Session plans   | `server/src/routes/plans.ts`, `client/src/ScreenshotSection.tsx` |
| Strava          | `server/src/routes/strava.ts`, `client/src/StravaSection.tsx` |
| Sessions / score| `server/src/routes/sessions.ts`, `client/src/PreviousResults.tsx` |
| Coach narrative | `server/src/lib/coach-narrative.ts` |
| DB & migrations | `server/src/db/schema.ts`, `server/src/db/index.ts`, `server/drizzle/*.sql` |
| App shell       | `client/src/App.tsx`, `client/src/Auth.tsx` |

Use this doc in a new chat so the next session can continue from here and help with going live or further changes.
