CREATE TABLE `gallery_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`caption` text,
	`credit` text,
	`taken_at` integer,
	`tag` text,
	`alt_text` text NOT NULL,
	`image_key` text NOT NULL,
	`image_bytes` integer NOT NULL,
	`width_px` integer NOT NULL,
	`height_px` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gallery_photos_public_id_unique` ON `gallery_photos` (`public_id`);--> statement-breakpoint
CREATE INDEX `gallery_photos_taken_at_idx` ON `gallery_photos` (`taken_at`);--> statement-breakpoint
CREATE INDEX `gallery_photos_tag_idx` ON `gallery_photos` (`tag`);