PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_waiver_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle` text NOT NULL,
	`version` text NOT NULL,
	`attested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`attested_by` text,
	`revoked_at` integer,
	`revoked_by` text,
	`revocation_reason` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_waiver_attestations`("id", "user_id", "cycle", "version", "attested_at", "attested_by", "revoked_at", "revoked_by", "revocation_reason", "notes") SELECT "id", "user_id", "cycle", "version", "attested_at", "attested_by", "revoked_at", "revoked_by", "revocation_reason", "notes" FROM `waiver_attestations`;--> statement-breakpoint
DROP TABLE `waiver_attestations`;--> statement-breakpoint
ALTER TABLE `__new_waiver_attestations` RENAME TO `waiver_attestations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `waiver_attestations_user_cycle` ON `waiver_attestations` (`user_id`,`cycle`);--> statement-breakpoint
CREATE INDEX `waiver_attestations_cycle_version_revoked` ON `waiver_attestations` (`cycle`,`version`,`revoked_at`);