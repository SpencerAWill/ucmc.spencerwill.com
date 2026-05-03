-- Seed the audit:view permission for the /members/audit viewer.
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions row is needed
-- for it. Advisor gets it by default — the constitutional CSA reporter
-- needs read access to incident-relevant events without needing a
-- system_admin elevation. Treasurer + President do NOT get it; their
-- constitutional duties (waiver attestation, financial actions) don't
-- require browsing the audit log.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_audit_view',
   'audit:view',
   'Read the append-only audit log of admin / officer actions at /members/audit');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_advisor', 'perm_audit_view');
