CREATE TABLE `route_decision` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`repository_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`run_attempt` integer NOT NULL,
	`step` text,
	`runner` text,
	`skipped` text NOT NULL,
	`not_in_order` text NOT NULL,
	`machine` text NOT NULL,
	`github` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_decision_run_idx` ON `route_decision` (`repository_id`,`run_id`,`run_attempt`);