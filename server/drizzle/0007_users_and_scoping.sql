CREATE TABLE IF NOT EXISTS `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO users (id, email, password_hash, display_name, created_at) VALUES (1, 'default@local', 'x', NULL, (strftime('%s','now')*1000));
--> statement-breakpoint
ALTER TABLE `goals` ADD COLUMN `user_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `strava_credentials` ADD COLUMN `user_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `parsed_plans` ADD COLUMN `user_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `session_scores` ADD COLUMN `user_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `session_scores` ADD COLUMN `selected_lap_ids` text;
