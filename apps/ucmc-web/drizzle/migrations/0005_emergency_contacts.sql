CREATE TABLE `emergency_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`relationship` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `emergency_contacts` (`id`, `user_id`, `name`, `phone`, `relationship`, `created_at`)
SELECT 'ec_' || lower(hex(randomblob(16))),
       `user_id`,
       `emergency_contact_name`,
       `emergency_contact_phone`,
       'other',
       `updated_at`
FROM `profiles`
WHERE `emergency_contact_name` IS NOT NULL
  AND `emergency_contact_name` != '';
--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `emergency_contact_name`;
--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `emergency_contact_phone`;
