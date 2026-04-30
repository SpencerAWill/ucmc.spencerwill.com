CREATE TABLE `waiver_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle` text NOT NULL,
	`version` text NOT NULL,
	`attested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`attested_by` text NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`revocation_reason` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `waiver_attestations_user_cycle` ON `waiver_attestations` (`user_id`,`cycle`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `policies_acknowledged_at` integer;--> statement-breakpoint
ALTER TABLE `profiles` ADD `policies_version` text;