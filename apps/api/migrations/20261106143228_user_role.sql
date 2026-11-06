ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
-- The first operators, by GitHub user ID: zachdunn (138033) and atticoos (656630).
UPDATE `user` SET `role` = 'operator' WHERE `id` IN (SELECT `user_id` FROM `account` WHERE `provider_id` = 'github' AND `account_id` IN ('138033', '656630'));
