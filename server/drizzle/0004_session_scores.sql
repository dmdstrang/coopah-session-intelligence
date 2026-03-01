CREATE TABLE IF NOT EXISTS `session_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parsed_plan_id` integer NOT NULL,
	`strava_activity_id` integer NOT NULL,
	`pace_score` integer NOT NULL,
	`volume_score` integer NOT NULL,
	`intensity_score` integer NOT NULL,
	`total_score` integer NOT NULL,
	`breakdown` text,
	`created_at` integer NOT NULL
);
