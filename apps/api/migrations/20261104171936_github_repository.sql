CREATE TABLE `github_repository` (
	`id` integer PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`private` integer NOT NULL,
	`removed_at` integer,
	`github_state_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_repository_installation_idx` ON `github_repository` (`installation_id`);