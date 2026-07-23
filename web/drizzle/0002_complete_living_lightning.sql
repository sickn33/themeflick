CREATE TABLE `favorite_accounts` (
	`user_email` text(254) PRIMARY KEY NOT NULL,
	`storage_scope` text(64) NOT NULL,
	`generation` text(64) NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorite_accounts_storage_scope_idx` ON `favorite_accounts` (`storage_scope`);--> statement-breakpoint
CREATE TABLE `favorite_operations` (
	`user_email` text(254) NOT NULL,
	`operation_id` text(64) NOT NULL,
	`generation` text(64) NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_email`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `favorite_operations_created_idx` ON `favorite_operations` (`created_at`);--> statement-breakpoint
CREATE TABLE `request_budgets` (
	`scope` text(160) PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `favorites` ADD `metadata_refreshed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;