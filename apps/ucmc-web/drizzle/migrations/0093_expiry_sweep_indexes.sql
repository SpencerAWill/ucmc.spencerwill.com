CREATE INDEX `magic_links_expires_at_idx` ON `magic_links` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `webauthn_consumed_ceremonies_expires_at_idx` ON `webauthn_consumed_ceremonies` (`expires_at`);