import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { stravaCredentials } from "../db/schema.js";
import type { AuthRequest } from "../middleware/auth.js";
import {
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getActivities,
  getActivity,
  getActivityLaps,
  getActivityStreams,
} from "../services/strava.js";

export const stravaRouter = Router();

function getStravaConfig() {
  return {
    clientId: (process.env.STRAVA_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.STRAVA_CLIENT_SECRET ?? "").trim(),
    redirectUri: process.env.STRAVA_REDIRECT_URI ?? "http://localhost:3001/api/strava/callback",
    frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  };
}

/** Get valid access token for user, refreshing if needed. Exported for use by sessions. */
export async function getValidAccessToken(userId: number): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const [row] = await db.select().from(stravaCredentials).where(eq(stravaCredentials.userId, userId)).limit(1);
  if (!row) {
    throw new Error("Not connected to Strava");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (row.expiresAt > nowSec + 300) {
    return {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: row.expiresAt,
    };
  }
  const config = getStravaConfig();
  const refreshed = await refreshAccessToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: row.refreshToken,
  });
  await db
    .update(stravaCredentials)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: refreshed.expires_at,
    })
    .where(eq(stravaCredentials.id, row.id));
  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: refreshed.expires_at,
  };
}

/** GET /api/strava/auth-url — URL to send user to for OAuth (state = userId) */
stravaRouter.get("/auth-url", (req: AuthRequest, res) => {
  const config = getStravaConfig();
  const userId = req.userId!;
  if (!config.clientId) {
    return res.status(500).json({
      error: "Strava client ID not configured. Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in server/.env",
    });
  }
  const url = getAuthUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state: String(userId),
  });
  res.json({ url });
});

/** GET /api/strava/callback?code=...&state=userId — OAuth callback; store tokens for user in state */
stravaRouter.get("/callback", async (req, res) => {
  const config = getStravaConfig();
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;
  if (error === "access_denied") {
    return res.redirect(`${config.frontendOrigin}?strava=denied`);
  }
  if (!code) {
    return res.redirect(`${config.frontendOrigin}?strava=error`);
  }
  const userId = state ? parseInt(state, 10) : 1;
  if (Number.isNaN(userId) || userId < 1) {
    return res.redirect(`${config.frontendOrigin}?strava=error`);
  }
  try {
    const tokens = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: config.redirectUri,
    });
    const existing = await db.select().from(stravaCredentials).where(eq(stravaCredentials.userId, userId)).limit(1);
    if (existing.length > 0) {
      await db
        .update(stravaCredentials)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_at,
        })
        .where(eq(stravaCredentials.id, existing[0].id));
    } else {
      await db.insert(stravaCredentials).values({
        userId,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_at,
      });
    }
    res.redirect(`${config.frontendOrigin}?strava=connected`);
  } catch (e) {
    console.error("Strava callback error:", e);
    res.redirect(`${config.frontendOrigin}?strava=error`);
  }
});

/** GET /api/strava/status — whether we have credentials for this user */
stravaRouter.get("/status", async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const [row] = await db.select().from(stravaCredentials).where(eq(stravaCredentials.userId, userId)).limit(1);
  res.json({ connected: !!row });
});

/** GET /api/strava/activities — last 10 activities */
stravaRouter.get("/activities", async (req: AuthRequest, res) => {
  try {
    const { accessToken } = await getValidAccessToken(req.userId!);
    const activities = await getActivities(accessToken);
    res.json(activities);
  } catch (e) {
    if (e instanceof Error && e.message === "Not connected to Strava") {
      return res.status(401).json({ error: "Not connected to Strava" });
    }
    console.error(e);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

/** GET /api/strava/activities/:id — activity with metadata, laps, streams */
stravaRouter.get("/activities/:id", async (req: AuthRequest, res) => {
  const id = req.params.id;
  try {
    const { accessToken } = await getValidAccessToken(req.userId!);
    const [activity, laps, streams] = await Promise.all([
      getActivity(id, accessToken),
      getActivityLaps(id, accessToken).catch(() => []),
      getActivityStreams(id, accessToken).catch(() => []),
    ]);
    res.json({
      ...activity,
      laps,
      streams,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Not connected to Strava") {
      return res.status(401).json({ error: "Not connected to Strava" });
    }
    console.error(e);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});
