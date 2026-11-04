CREATE TABLE `activity_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`machine_id` text,
	`job_id` integer,
	`actor_user_id` text,
	`data` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machine_id`) REFERENCES `machine`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `workflow_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_event_workspace_idx` ON `activity_event` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_event_job_idx` ON `activity_event` (`job_id`,`type`);