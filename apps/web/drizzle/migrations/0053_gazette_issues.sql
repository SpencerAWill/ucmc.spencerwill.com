CREATE TABLE `gazette_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`school_year` text NOT NULL,
	`start_year` integer NOT NULL,
	`issue_number` integer NOT NULL,
	`title` text,
	`editor` text,
	`published_at` integer,
	`description` text,
	`pdf_key` text NOT NULL,
	`pdf_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gazette_issues_public_id_unique` ON `gazette_issues` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gazette_issues_year_number_unique` ON `gazette_issues` (`school_year`,`issue_number`);--> statement-breakpoint
CREATE INDEX `gazette_issues_sort_idx` ON `gazette_issues` (`start_year`,`issue_number`);