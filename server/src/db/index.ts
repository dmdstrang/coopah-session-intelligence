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
