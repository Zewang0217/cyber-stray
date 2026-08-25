CREATE TABLE `wechat_bindings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`ilink_user_id` text NOT NULL,
	`ilink_bot_id` text NOT NULL,
	`base_url` text NOT NULL,
	`status` text DEFAULT 'paired' NOT NULL,
	`bound_at` integer NOT NULL,
	`last_interaction_at` integer,
	`last_error` text,
	`get_updates_buf` text,
	`pushes_date` text,
	`pushes_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
