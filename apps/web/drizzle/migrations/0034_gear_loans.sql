CREATE TABLE `gear_loans` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`gear_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`checked_out_by_user_id` text,
	`checked_out_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`returned_at` integer,
	`returned_to_user_id` text,
	`checkout_notes` text,
	`checkin_notes` text,
	`condition_at_return` text,
	FOREIGN KEY (`gear_id`) REFERENCES `gear`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`member_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`checked_out_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`returned_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gear_loans_public_id_unique` ON `gear_loans` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_loans_one_active_per_gear` ON `gear_loans` (`gear_id`) WHERE "gear_loans"."returned_at" IS NULL;--> statement-breakpoint
CREATE INDEX `gear_loans_member_returned_idx` ON `gear_loans` (`member_user_id`,`returned_at`);--> statement-breakpoint
CREATE INDEX `gear_loans_gear_idx` ON `gear_loans` (`gear_id`);--> statement-breakpoint
CREATE INDEX `gear_loans_due_idx` ON `gear_loans` (`due_at`);