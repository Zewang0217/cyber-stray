CREATE TABLE `admins` (
	`sub` text PRIMARY KEY NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
-- 数据回填：既有租户的 plan 从 pets.plan 复制（1 租户 1 宠物下等价）；
-- 无宠物租户保持默认 free
UPDATE `tenants` SET `plan` = COALESCE(
  (SELECT `pets`.`plan` FROM `pets` WHERE `pets`.`tenant_id` = `tenants`.`id` LIMIT 1),
  'free'
);