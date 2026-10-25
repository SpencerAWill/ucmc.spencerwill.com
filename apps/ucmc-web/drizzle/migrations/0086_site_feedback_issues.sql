CREATE TABLE `site_feedback_issue_links` (
	`issue_id` text NOT NULL,
	`feedback_id` text NOT NULL,
	`quoted_md` text NOT NULL,
	`posted_at` integer,
	`added_by` text,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`issue_id`, `feedback_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `site_feedback_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `site_feedback_issue_links_feedback_idx` ON `site_feedback_issue_links` (`feedback_id`);--> statement-breakpoint
CREATE TABLE `site_feedback_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`summary_md` text,
	`labels` text DEFAULT '[]' NOT NULL,
	`github_number` integer,
	`github_url` text,
	`github_synced_at` integer,
	`filing_started_at` integer,
	`created_by` text,
	`filed_by` text,
	`filed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`filed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_feedback_issues_github_number_idx` ON `site_feedback_issues` (`github_number`);--> statement-breakpoint
CREATE INDEX `site_feedback_issues_state_updated_at_idx` ON `site_feedback_issues` (`state`,`updated_at`);