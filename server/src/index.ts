import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { goalRouter } from "./routes/goal.js";
import { stravaRouter } from "./routes/strava.js";
import { plansRouter } from "./routes/plans.js";
import { sessionsRouter } from "./routes/sessions.js";
import { optionalAuth, requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const parsed = dotenv.parse(fs.readFileSync(envPath, "utf-8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (!k || k.startsWith("#")) continue;
    const val = (v ?? "").trim().replace(/^["']|["']$/g, "");
    process.env[k] = val;
  }
} else {
  dotenv.config({ path: envPath });
}
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(optionalAuth);
app.use("/api/auth", authRouter);
app.use("/api/goal", requireAuth, goalRouter);
app.use("/api/strava", requireAuth, stravaRouter);
app.use("/api/plans", requireAuth, plansRouter);
app.use("/api/sessions", requireAuth, sessionsRouter);

// Production: serve client build and SPA fallback
const isProd = process.env.NODE_ENV === "production";
const clientDist = path.join(__dirname, "../../client/dist");
if (isProd && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  const clientId = (process.env.STRAVA_CLIENT_ID ?? "").trim();
  if (!clientId) {
    console.warn("Strava: STRAVA_CLIENT_ID is empty. In server/.env put your ID on the same line as STRAVA_CLIENT_ID= with no spaces (e.g. STRAVA_CLIENT_ID=12345).");
  } else {
    console.log("Strava: STRAVA_CLIENT_ID loaded (length " + clientId.length + ").");
  }
});
