CREATE TABLE IF NOT EXISTS `strava_credentials` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `refresh_token` text NOT NULL,
  `access_token` text NOT NULL,
  `expires_at` integer NOT NULL
);
