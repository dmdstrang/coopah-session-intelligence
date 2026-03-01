import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../../data/sqlite.db");

// Ensure data dir exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(dbPath);

const migrationOrder = [
  "0000_init.sql",
  "0001_strava_credentials.sql",
  "0002_parsed_plans.sql",
  "0003_parsed_plans_coach_message.sql",
  "0004_session_scores.sql",
  "0005_big_exodus.sql",
  "0006_lazy_madame_hydra.sql",
  "0007_users_and_scoping.sql",
];

/** Inline migration SQL so we can run without the drizzle folder (e.g. Render deploy). */
const INLINE_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS goals (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, race_name text NOT NULL, distance text NOT NULL, goal_time_sec integer NOT NULL, race_date text NOT NULL, created_at integer NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS strava_credentials (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, refresh_token text NOT NULL, access_token text NOT NULL, expires_at integer NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS parsed_plans (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, session_name text NOT NULL, work_blocks text NOT NULL, confidence integer NOT NULL, created_at integer NOT NULL);`,
  `ALTER TABLE parsed_plans ADD COLUMN coach_message text;`,
  `CREATE TABLE IF NOT EXISTS session_scores (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, parsed_plan_id integer NOT NULL, strava_activity_id integer NOT NULL, pace_score integer NOT NULL, volume_score integer NOT NULL, intensity_score integer NOT NULL, total_score integer NOT NULL, breakdown text, created_at integer NOT NULL);`,
  `ALTER TABLE session_scores ADD COLUMN session_threshold_sec_per_mile integer;`,
  `CREATE TABLE IF NOT EXISTS fitness_snapshots (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, session_score_id integer NOT NULL, estimated_threshold_sec_per_mile integer NOT NULL, t5k_sec integer NOT NULL, t10k_sec integer NOT NULL, thalf_sec integer NOT NULL, tmarathon_sec integer NOT NULL, trend_drift integer, trend_z5 integer, trend_exec integer, fatigue_index integer, fatigue_state text, execution_consistency_index integer, hr_stability_index integer, prediction_confidence integer, fitness_trend_state text, sessions_count integer NOT NULL, created_at integer NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS users (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, email text NOT NULL, password_hash text NOT NULL, display_name text, created_at integer NOT NULL);`,
  `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, created_at) VALUES (1, 'default@local', 'x', NULL, (strftime('%s','now')*1000));`,
  `ALTER TABLE goals ADD COLUMN user_id integer DEFAULT 1 NOT NULL;`,
  `ALTER TABLE strava_credentials ADD COLUMN user_id integer DEFAULT 1 NOT NULL;`,
  `ALTER TABLE parsed_plans ADD COLUMN user_id integer DEFAULT 1 NOT NULL;`,
  `ALTER TABLE session_scores ADD COLUMN user_id integer DEFAULT 1 NOT NULL;`,
  `ALTER TABLE session_scores ADD COLUMN selected_lap_ids text;`,
];

function runStatement(stmt: string): void {
  try {
    sqlite.exec(stmt);
  } catch (e) {
    if (String(e).includes("duplicate column")) return; // already migrated
    throw e;
  }
}

/** Run all Drizzle migrations if DB is fresh (e.g. first deploy on Render). */
function runMigrationsIfNeeded(): void {
  const hasGoals = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='goals'").get();
  if (hasGoals) return;

  const possibleDrizzleDirs = [
    path.resolve(__dirname, "../../drizzle"),
    path.join(process.cwd(), "server", "drizzle"),
    path.join(process.cwd(), "drizzle"),
  ];
  let drizzleDir: string | null = null;
  for (const dir of possibleDrizzleDirs) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, migrationOrder[0]))) {
      drizzleDir = dir;
      break;
    }
  }

  if (drizzleDir) {
    console.log("[db] Fresh DB detected, applying migrations from", drizzleDir);
    for (const name of migrationOrder) {
      const filePath = path.join(drizzleDir, name);
      if (!fs.existsSync(filePath)) continue;
      const sql = fs.readFileSync(filePath, "utf-8");
      const statements = sql
        .split(/-->\s*statement-breakpoint/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));
      for (const stmt of statements) {
        if (stmt) runStatement(stmt);
      }
    }
  } else {
    console.log("[db] Fresh DB detected, applying inline migrations (drizzle dir not found)");
    for (const stmt of INLINE_MIGRATIONS) {
      runStatement(stmt);
    }
  }
}

runMigrationsIfNeeded();

/** Run migration 0007 if users table is missing (same DB file the app uses). */
function ensureUsersMigration(): void {
  const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (row) return;
  console.log("[db] Applying users migration to", dbPath);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      display_name text,
      created_at integer NOT NULL
    );
    INSERT OR IGNORE INTO users (id, email, password_hash, display_name, created_at) VALUES (1, 'default@local', 'x', NULL, (strftime('%s','now')*1000));
  `);
  // Add user_id / selected_lap_ids if tables exist and columns missing
  const tables = ["goals", "strava_credentials", "parsed_plans", "session_scores"];
  for (const table of tables) {
    const t = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name?: string } | undefined;
    if (t && table !== "session_scores") {
      try {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN user_id integer DEFAULT 1 NOT NULL`);
      } catch (_) {
        /* column already exists */
      }
    }
  }
  try {
    sqlite.exec("ALTER TABLE session_scores ADD COLUMN user_id integer DEFAULT 1 NOT NULL");
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE session_scores ADD COLUMN selected_lap_ids text");
  } catch (_) {}
}

ensureUsersMigration();

export const db = drizzle(sqlite, { schema });
export * from "./schema.js";
