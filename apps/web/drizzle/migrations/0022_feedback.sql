CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`page_url` text,
	`user_agent` text,
	`created_by` text,
	`github_issue_number` integer,
	`github_issue_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_status_created_at_idx` ON `feedback` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_created_by_idx` ON `feedback` (`created_by`);