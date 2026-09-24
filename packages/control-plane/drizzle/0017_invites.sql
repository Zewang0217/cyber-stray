-- 内测邀请（#301，#273 拍板）：一次性链接凭证。
-- raw token 不落库（只存 sha256，raw 仅在生成响应里出现一次）；
-- 一次性（consumed_at）+ 可吊销（revoked_at）；
-- consumed_tenant_id 记归因（invitedBy：由此邀请建立的租户）。
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`consumed_at` integer,
	`consumed_tenant_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);
