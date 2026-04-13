-- Seed roles + permissions + role_permissions. Idempotent; safe to re-run.

INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role_system_admin',   'system_admin',   'System administrator'),
  ('role_president',      'president',      'Club president'),
  ('role_vice_president', 'vice_president', 'Vice president'),
  ('role_exec',           'exec',           'Other exec member (treasurer, secretary, etc.)'),
  ('role_member',         'member',         'Approved member');

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_registrations_approve', 'registrations:approve', 'Approve or reject pending member registrations'),
  ('perm_users_manage_roles',    'users:manage_roles',    'Assign roles to users'),
  ('perm_admin_panel',           'admin:panel',           'Access the system admin panel');

-- system_admin gets all permissions.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_system_admin', 'perm_registrations_approve'),
  ('role_system_admin', 'perm_users_manage_roles'),
  ('role_system_admin', 'perm_admin_panel');

-- president, vice_president, exec can approve registrations.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_president',      'perm_registrations_approve'),
  ('role_vice_president', 'perm_registrations_approve'),
  ('role_exec',           'perm_registrations_approve');
