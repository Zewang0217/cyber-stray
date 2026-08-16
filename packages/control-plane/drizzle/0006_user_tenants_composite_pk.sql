PRAGMA foreign_keys=off;
--> statement-breakpoint
CREATE TABLE `user_tenants_v2` (
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `tenant_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `user_tenants_v2` (`user_id`, `tenant_id`, `role`, `joined_at`)
	SELECT `user_id`, `tenant_id`, `role`, `joined_at` FROM `user_tenants`;
--> statement-breakpoint
DROP TABLE `user_tenants`;
--> statement-breakpoint
ALTER TABLE `user_tenants_v2` RENAME TO `user_tenants`;
--> statement-breakpoint
PRAGMA foreign_keys=on;
