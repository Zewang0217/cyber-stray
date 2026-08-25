CREATE TABLE `pet_gen_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`status` text DEFAULT 'spec_submitted' NOT NULL,
	`spec_text` text NOT NULL,
	`options` text,
	`style_preset` text,
	`concept_path` text,
	`strategy` text DEFAULT 'quad' NOT NULL,
	`batch_retries` integer DEFAULT 0 NOT NULL,
	`qc_retries` integer DEFAULT 0 NOT NULL,
	`qc_result` text,
	`pending_states` text,
	`concept_attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pet_gen_tasks_tenant_idx` ON `pet_gen_tasks` (`tenant_id`);