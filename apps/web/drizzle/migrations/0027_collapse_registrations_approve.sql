-- Collapse `registrations:approve` into `members:manage`. The two
-- permissions originally distinguished registration triage from
-- post-approval lifecycle, but the page that used them now covers the
-- full member lifecycle (pending, unclaimed, rejected, deactivated)
-- and the split was costing more than it bought. Going forward,
-- `members:manage` gates the entire member-management surface.
--
-- Idempotent INSERT/DELETE — safe to re-run by hand.

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_system_admin', 'perm_members_manage');
--> statement-breakpoint

DELETE FROM role_permissions WHERE permission_id = 'perm_registrations_approve';
--> statement-breakpoint

DELETE FROM permissions WHERE id = 'perm_registrations_approve';
