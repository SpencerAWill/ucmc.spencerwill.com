-- Seed three new permissions for member lifecycle management,
-- private data access, and session revocation.
-- Uses INSERT OR IGNORE for idempotency (same pattern as 0001_rbac_seed.sql).

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_members_manage',
   'members:manage',
   'Deactivate, reactivate, and un-reject members; edit other users'' profiles'),
  ('perm_members_view_private',
   'members:view_private',
   'View private member data such as phone, emergency contact, and M-number'),
  ('perm_sessions_revoke',
   'sessions:revoke',
   'Force sign-out another user by revoking their sessions');
