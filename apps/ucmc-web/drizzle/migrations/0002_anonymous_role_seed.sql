-- Seed the anonymous pseudo-role. Admins assign permissions to this role
-- to control what unauthenticated visitors can see. The role is never
-- assigned to a user; its permissions are loaded separately and cached
-- in KV. Protected from deletion like system_admin and member.

INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role_anonymous', 'anonymous', 'Controls what unauthenticated visitors can access');
