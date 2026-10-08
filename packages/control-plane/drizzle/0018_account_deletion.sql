ALTER TABLE `tenants` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tenants` ADD `deletion_mode` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `deletion_reason` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `deleted_by` text;