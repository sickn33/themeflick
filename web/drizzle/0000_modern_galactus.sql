CREATE TABLE `favorites` (
	`user_email` text(254) NOT NULL,
	`movie_id` integer NOT NULL,
	`title` text(160) NOT NULL,
	`poster_path` text(200),
	`release_date` text(10),
	`vote_average` real NOT NULL,
	`saved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_email`, `movie_id`)
);
--> statement-breakpoint
CREATE INDEX `favorites_user_saved_idx` ON `favorites` (`user_email`,`saved_at`,`movie_id`);