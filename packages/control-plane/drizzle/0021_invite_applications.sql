CREATE TABLE `invite_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`nickname` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`invite_id` text,
	`invite_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_applications_public_id_unique` ON `invite_applications` (`public_id`);