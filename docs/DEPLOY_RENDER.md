# Deploy to Render — step-by-step

## 1. Push your code to GitHub

If you haven’t already:

```bash
cd "/Users/coopah/Desktop/MVP Coopah Post Session"
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 2. Create the app on Render

1. Go to **[dashboard.render.com](https://dashboard.render.com)** and sign up / log in.
2. Click **New +** → **Blueprint**.
3. Connect **GitHub** if needed (authorize the Render app for your account/repo).
4. Select the repo that contains this project and the branch (e.g. `main`).
5. Leave **Blueprint Path** as `render.yaml` (root).
6. Click **Apply**. Render will create one web service from `render.yaml`.
7. Click **Create Web Service** / **Deploy** when prompted.

## 3. Add environment variables

In the Render dashboard, open your new **Web Service** → **Environment** tab.

Add these (use **Add Environment Variable**):

| Key | Value |
|-----|--------|
| `STRAVA_CLIENT_ID` | Your Strava app ID from [strava.com/settings/api](https://www.strava.com/settings/api) |
| `STRAVA_CLIENT_SECRET` | Your Strava app secret |
| `OPENAI_API_KEY` | (Optional) For screenshot OCR and coach narrative |

**After the first deploy** you’ll get a URL like `https://coopah-session-intelligence-xxxx.onrender.com`. Then add:

| Key | Value |
|-----|--------|
| `STRAVA_REDIRECT_URI` | `https://YOUR-ACTUAL-URL.onrender.com/api/strava/callback` |
| `FRONTEND_ORIGIN` | `https://YOUR-ACTUAL-URL.onrender.com` |

Replace `YOUR-ACTUAL-URL` with the host Render shows (e.g. `coopah-session-intelligence-abc1`).

**Save**. Render will redeploy when you add/change env vars.

## 4. Strava callback domain

1. Open [Strava API settings](https://www.strava.com/settings/api).
2. Under **Authorization Callback Domain** enter only the hostname, e.g.:
   ```text
   coopah-session-intelligence-xxxx.onrender.com
   ```
   (No `https://` or path.)

## 5. Open the app

In Render, open your service and click the **URL** (e.g. `https://...onrender.com`). You should see the app; sign up and use it.

---

**Notes**

- **JWT_SECRET** and **NODE_ENV** are set by `render.yaml` (Render generates a secret for JWT).
- Free tier: service may **spin down** after ~15 min idle; the first request after that can take 30–60 seconds.
- Free tier: **disk is ephemeral** — SQLite data is lost on redeploy. Fine for trying out; for real use you’d add a persistent disk or a hosted DB later.
