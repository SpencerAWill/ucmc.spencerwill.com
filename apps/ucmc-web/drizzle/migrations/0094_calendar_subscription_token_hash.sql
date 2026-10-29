ALTER TABLE `calendar_subscriptions` ADD `token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_subscriptions_token_hash_unique` ON `calendar_subscriptions` (`token_hash`);