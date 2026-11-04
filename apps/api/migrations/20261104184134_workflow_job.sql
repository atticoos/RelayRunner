CREATE TABLE `workflow_job` (
	`id` integer PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`repository_id` integer NOT NULL,
	`repository_full_name` text NOT NULL,
	`run_id` integer NOT NULL,
	`run_attempt` integer NOT NULL,
	`kind` text NOT NULL,
	`workflow_name` text,
	`name` text NOT NULL,
	`labels` text NOT NULL,
	`head_branch` text,
	`head_sha` text NOT NULL,
	`status` text NOT NULL,
	`conclusion` text,
	`runner_name` text,
	`github_created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_job_installation_idx` ON `workflow_job` (`installation_id`,`id`);--> statement-breakpoint
CREATE INDEX `workflow_job_run_idx` ON `workflow_job` (`run_id`,`kind`);