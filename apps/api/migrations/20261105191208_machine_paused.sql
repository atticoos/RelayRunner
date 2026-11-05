ALTER TABLE `machine` ADD `paused_at` integer;--> statement-breakpoint
ALTER TABLE `machine` ADD `paused_by` text REFERENCES user(id) ON DELETE set null;