import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Simple accounts: one row per user. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: integer("created_at")
    .$defaultFn(() => Date.now())
    .notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  raceName: text("race_name").notNull(),
  distance: text("distance", {
    enum: ["5k", "10k", "half", "marathon", "custom"],
  }).notNull(),
  goalTimeSec: integer("goal_time_sec").notNull(),
  raceDate: text("race_date").notNull(), // YYYY-MM-DD
  createdAt: integer("created_at")
    .$defaultFn(() => Date.now())
    .notNull(),
});

export type GoalRow = typeof goals.$inferSelect;
export type GoalInsert = typeof goals.$inferInsert;

export const stravaCredentials = sqliteTable("strava_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token").notNull(),
  expiresAt: integer("expires_at").notNull(), // seconds since epoch
});

export type StravaCredentialsRow = typeof stravaCredentials.$inferSelect;
export type StravaCredentialsInsert = typeof stravaCredentials.$inferInsert;

export const parsedPlans = sqliteTable("parsed_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  sessionName: text("session_name").notNull(),
  coachMessage: text("coach_message"), // from PACE screen
  workBlocks: text("work_blocks").notNull(), // JSON array (intervals)
  confidence: integer("confidence").notNull(), // 0-100
  createdAt: integer("created_at")
    .$defaultFn(() => Date.now())
    .notNull(),
});

export type ParsedPlanRow = typeof parsedPlans.$inferSelect;
export type ParsedPlanInsert = typeof parsedPlans.$inferInsert;

export const sessionScores = sqliteTable("session_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  parsedPlanId: integer("parsed_plan_id").notNull(),
  stravaActivityId: integer("strava_activity_id").notNull(),
  paceScore: integer("pace_score").notNull(), // 0-40
  volumeScore: integer("volume_score").notNull(), // 0-20
  intensityScore: integer("intensity_score").notNull(), // 0-40
  totalScore: integer("total_score").notNull(), // 0-100
  breakdown: text("breakdown"), // JSON: per-rep pace, etc.
  sessionThresholdSecPerMile: integer("session_threshold_sec_per_mile"), // Phase 6: weighted pace + drift/z5 adj
  selectedLapIds: text("selected_lap_ids"), // JSON number[] for reanalyse
  createdAt: integer("created_at")
    .$defaultFn(() => Date.now())
    .notNull(),
});

export type SessionScoreRow = typeof sessionScores.$inferSelect;
export type SessionScoreInsert = typeof sessionScores.$inferInsert;

/** Phase 8: one row per analysis (append-only). Latest row = current fitness state. */
export const fitnessSnapshots = sqliteTable("fitness_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionScoreId: integer("session_score_id").notNull(),
  estimatedThresholdSecPerMile: integer("estimated_threshold_sec_per_mile").notNull(),
  t5kSec: integer("t5k_sec").notNull(),
  t10kSec: integer("t10k_sec").notNull(),
  thalfSec: integer("thalf_sec").notNull(),
  tmarathonSec: integer("tmarathon_sec").notNull(),
  trendDrift: integer("trend_drift"), // stored as 0-100 for SQLite
  trendZ5: integer("trend_z5"),
  trendExec: integer("trend_exec"),
  fatigueIndex: integer("fatigue_index"), // 0-100
  fatigueState: text("fatigue_state"), // Low | Stable | Building | High
  executionConsistencyIndex: integer("execution_consistency_index"), // 0-100
  hrStabilityIndex: integer("hr_stability_index"), // 0-100
  predictionConfidence: integer("prediction_confidence"), // 0-100
  fitnessTrendState: text("fitness_trend_state"), // improving | stable | plateauing | declining
  sessionsCount: integer("sessions_count").notNull(),
  createdAt: integer("created_at")
    .$defaultFn(() => Date.now())
    .notNull(),
});

export type FitnessSnapshotRow = typeof fitnessSnapshots.$inferSelect;
export type FitnessSnapshotInsert = typeof fitnessSnapshots.$inferInsert;
