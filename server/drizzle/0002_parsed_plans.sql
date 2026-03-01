CREATE TABLE IF NOT EXISTS `parsed_plans` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_name` text NOT NULL,
  `work_blocks` text NOT NULL,
  `confidence` integer NOT NULL,
  `created_at` integer NOT NULL
);
