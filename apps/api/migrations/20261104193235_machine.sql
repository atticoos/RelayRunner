CREATE TABLE `device_code` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_device_code_unique` ON `device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_user_code_unique` ON `device_code` (`user_code`);--> statement-breakpoint
CREATE TABLE `machine` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`os` text,
	`arch` text,
	`token_hash` text,
	`enrollment_hash` text,
	`created_by` text,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machine_token_hash_unique` ON `machine` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `machine_enrollment_hash_unique` ON `machine` (`enrollment_hash`);--> statement-breakpoint
CREATE INDEX `machine_workspace_idx` ON `machine` (`workspace_id`);