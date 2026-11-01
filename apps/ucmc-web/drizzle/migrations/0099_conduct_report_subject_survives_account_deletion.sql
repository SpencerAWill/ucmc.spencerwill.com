-- A report about a member must survive that member's account deletion or
-- purge (docs/adr/0012-conduct-records-outlive-the-account.md).
--
-- `conduct_reports.subject_user_id` is ON DELETE SET NULL, but the
-- `conduct_reports_subject_known` CHECK requires a subject user or a
-- free-text description. A report filed against a picked member carries no
-- description, so nulling the user would fail the CHECK and the whole
-- `DELETE FROM users` with it: the member could neither delete their
-- account nor be purged. This trigger stamps the description first, from
-- the profile name (a blank name falls back to 'Former member') (BEFORE DELETE runs ahead of the FK actions and the
-- profile cascade), so the report keeps naming who it was about.
--
-- Additive only. The trigger belongs to `users`; a migration that rebuilds
-- `users` drops it and must recreate it. Not in `schema.ts`.

CREATE TRIGGER `conduct_reports_keep_subject_on_user_delete`
BEFORE DELETE ON `users`
FOR EACH ROW
BEGIN
	UPDATE `conduct_reports`
	SET `subject_description` = COALESCE(
		(SELECT NULLIF(TRIM(`full_name`), '') FROM `profiles` WHERE `user_id` = OLD.`id`),
		'Former member'
	)
	WHERE `subject_user_id` = OLD.`id` AND `subject_description` IS NULL;
END;
