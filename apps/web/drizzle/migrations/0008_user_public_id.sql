ALTER TABLE `users` ADD `public_id` text;--> statement-breakpoint
UPDATE `users` SET `public_id` = lower(hex(randomblob(8))) WHERE `public_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_public_id_unique` ON `users` (`public_id`);