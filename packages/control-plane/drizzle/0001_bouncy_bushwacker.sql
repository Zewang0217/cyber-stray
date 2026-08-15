PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_tenants` (
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `tenant_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_tenants`("user_id", "tenant_id", "role", "joined_at") SELECT "user_id", "tenant_id", "role", "joined_at" FROM `user_tenants`;--> statement-breakpoint
DROP TABLE `user_tenants`;--> statement-breakpoint
ALTER TABLE `__new_user_tenants` RENAME TO `user_tenants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `pets` ADD `cooldown_until` integer;