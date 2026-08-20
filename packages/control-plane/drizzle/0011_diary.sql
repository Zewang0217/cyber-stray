ALTER TABLE `pets` ADD `diary_style` text DEFAULT 'personality';--> statement-breakpoint
ALTER TABLE `pets` ADD `diary_push_enabled` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `pets` ADD `last_diary_date` text;
