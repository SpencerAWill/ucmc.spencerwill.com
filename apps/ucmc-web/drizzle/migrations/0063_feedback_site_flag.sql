-- The website feedback surface moved from `/feedback` to `/feedback/site`
-- (with `/feedback` now redirecting to the club surface), and its page flag
-- follows the URL: `pages.feedback_website` -> `pages.feedback_site`.
--
-- Separate from 0061 rather than folded into it: 0061 is already pushed, and
-- editing an applied migration in place would leave any database that ran it
-- with a key nothing reads. A second rename is noisier history but cannot
-- desync.
--
-- The submission gate `feedback.website_enabled` keeps its key. Renaming it
-- would be churn for no reader — nothing keys off the string but the
-- registry — and its label already reads "Accept site feedback submissions".
UPDATE OR REPLACE site_settings
   SET key = 'pages.feedback_site'
 WHERE key = 'pages.feedback_website';
--> statement-breakpoint
UPDATE audit_log
   SET target_id = 'pages.feedback_site'
 WHERE action = 'settings_updated'
   AND target_id = 'pages.feedback_website';
