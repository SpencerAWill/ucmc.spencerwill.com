-- Seed permissions for the feedback feature.
-- feedback:submit → open the feedback form and view your own submissions
-- feedback:manage → triage all feedback (status changes, full list)
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions rows are needed
-- for it. role_member gets feedback:submit by default so every
-- approved member can send feedback.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_feedback_submit',
   'feedback:submit',
   'Open the feedback form and view your own submissions'),
  ('perm_feedback_manage',
   'feedback:manage',
   'Triage feedback: change status, view all submissions');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_feedback_submit');
