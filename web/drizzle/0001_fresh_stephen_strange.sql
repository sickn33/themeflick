DROP INDEX `favorites_user_saved_idx`;--> statement-breakpoint
ALTER TABLE `favorites` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `favorites_user_order_idx` ON `favorites` (`user_email`,`sort_order`,`movie_id`);