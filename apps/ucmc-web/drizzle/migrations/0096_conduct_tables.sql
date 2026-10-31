CREATE TABLE `conduct_blocked_emails` (
	`record_id` text NOT NULL,
	`email_hmac` text NOT NULL,
	PRIMARY KEY(`record_id`, `email_hmac`),
	FOREIGN KEY (`record_id`) REFERENCES `conduct_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conduct_blocked_emails_hmac_idx` ON `conduct_blocked_emails` (`email_hmac`);--> statement-breakpoint
CREATE TABLE `conduct_record_reports` (
	`record_id` text NOT NULL,
	`report_id` text NOT NULL,
	PRIMARY KEY(`record_id`, `report_id`),
	FOREIGN KEY (`record_id`) REFERENCES `conduct_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `conduct_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conduct_records` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`level` text NOT NULL,
	`subject_user_id` text,
	`subject_name_snapshot` text NOT NULL,
	`member_statement` text,
	`internal_notes` text,
	`starts_on` text,
	`ends_on` text,
	`scoc_state` text DEFAULT 'none' NOT NULL,
	`referred_on` text,
	`referred_by` text,
	`sccs_outcome_note` text,
	`vote_held_on` text,
	`votes_for` integer,
	`votes_against` integer,
	`votes_abstain` integer,
	`committee_size` integer,
	`prior_warning_id` text,
	`warning_skipped` integer DEFAULT false NOT NULL,
	`supersedes_id` text,
	`lifted_at` integer,
	`lifted_by` text,
	`lift_reason` text,
	`appeal_outcome` text,
	`notice_sent_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`retain_until` integer,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`referred_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`prior_warning_id`) REFERENCES `conduct_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_id`) REFERENCES `conduct_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lifted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "conduct_records_termination_vote" CHECK("conduct_records"."level" <> 'termination' OR ("conduct_records"."votes_for" IS NOT NULL AND "conduct_records"."votes_against" IS NOT NULL AND "conduct_records"."votes_abstain" IS NOT NULL AND "conduct_records"."committee_size" IS NOT NULL AND "conduct_records"."votes_for" * 3 >= "conduct_records"."committee_size" * 2 AND "conduct_records"."votes_for" + "conduct_records"."votes_against" + "conduct_records"."votes_abstain" <= "conduct_records"."committee_size" AND "conduct_records"."vote_held_on" IS NOT NULL)),
	CONSTRAINT "conduct_records_termination_warning" CHECK("conduct_records"."level" <> 'termination' OR (("conduct_records"."prior_warning_id" IS NOT NULL) <> ("conduct_records"."warning_skipped" = 1))),
	CONSTRAINT "conduct_records_suspension_dates" CHECK("conduct_records"."level" <> 'suspension' OR ("conduct_records"."starts_on" IS NOT NULL AND "conduct_records"."ends_on" IS NOT NULL AND "conduct_records"."ends_on" >= "conduct_records"."starts_on")),
	CONSTRAINT "conduct_records_statement_required" CHECK("conduct_records"."level" = 'note' OR "conduct_records"."member_statement" IS NOT NULL),
	CONSTRAINT "conduct_records_ends_on_level" CHECK("conduct_records"."level" IN ('suspension', 'warning') OR "conduct_records"."ends_on" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conduct_records_public_id_unique` ON `conduct_records` (`public_id`);--> statement-breakpoint
CREATE INDEX `conduct_records_subject_idx` ON `conduct_records` (`subject_user_id`);--> statement-breakpoint
CREATE INDEX `conduct_records_level_lifted_idx` ON `conduct_records` (`level`,`lifted_at`);--> statement-breakpoint
CREATE INDEX `conduct_records_retain_until_idx` ON `conduct_records` (`retain_until`);--> statement-breakpoint
CREATE TABLE `conduct_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`reporter_user_id` text,
	`subject_user_id` text,
	`subject_description` text,
	`occurred_on` text NOT NULL,
	`location` text,
	`body` text NOT NULL,
	`possible_scoc` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`triaged_by` text,
	`triaged_at` integer,
	`dismiss_reason` text,
	`retain_until` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`triaged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "conduct_reports_subject_known" CHECK("conduct_reports"."subject_user_id" IS NOT NULL OR "conduct_reports"."subject_description" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conduct_reports_public_id_unique` ON `conduct_reports` (`public_id`);--> statement-breakpoint
CREATE INDEX `conduct_reports_status_created_at_idx` ON `conduct_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `conduct_reports_retain_until_idx` ON `conduct_reports` (`retain_until`);