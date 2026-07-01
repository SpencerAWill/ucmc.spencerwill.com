-- Seed permissions for the club feedback feature. Parallel to
-- 0023_feedback_permissions_seed.sql:
--   club_feedback:submit → open the club feedback form, view your own submissions
--   club_feedback:manage → triage all club feedback (status changes, full list)
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions rows are needed
-- for it. role_member gets club_feedback:submit by default so every
-- approved member can send the exec board governance feedback.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_club_feedback_submit',
   'club_feedback:submit',
   'Open the club feedback form and view your own submissions'),
  ('perm_club_feedback_manage',
   'club_feedback:manage',
   'Triage club feedback: change status, view all submissions');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_club_feedback_submit');
