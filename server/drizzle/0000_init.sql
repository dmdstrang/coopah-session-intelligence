CREATE TABLE IF NOT EXISTS `goals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `race_name` text NOT NULL,
  `distance` text NOT NULL,
  `goal_time_sec` integer NOT NULL,
  `race_date` text NOT NULL,
  `created_at` integer NOT NULL
);
