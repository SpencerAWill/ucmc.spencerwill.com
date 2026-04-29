-- Seed the waivers:verify permission for the paper-attestation flow.
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions row is needed
-- for it. Treasurer + President seed rows (W-6) will pick this up.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_waivers_verify',
   'waivers:verify',
   'Mark a member''s paper waiver as attested for the current academic cycle, and revoke prior attestations');
