CREATE TABLE `invite_redemptions` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`redeemed_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `invites` ADD `max_uses` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `used_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `invites` SET `used_count` = 1 WHERE `consumed_at` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `invite_redemptions` (`tenant_id`, `invite_id`, `redeemed_at`)
SELECT i.`consumed_tenant_id`, i.`id`, i.`consumed_at` FROM `invites` i
WHERE i.`consumed_tenant_id` IS NOT NULL AND i.`consumed_at` IS NOT NULL
AND i.`id` = (SELECT prior.`id` FROM `invites` prior
  WHERE prior.`consumed_tenant_id` = i.`consumed_tenant_id` AND prior.`consumed_at` IS NOT NULL
  ORDER BY prior.`consumed_at`, prior.`id` LIMIT 1);
