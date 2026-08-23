-- Permission renames + two read/write splits.
--
-- ── Renames ───────────────────────────────────────────────────────────
-- `permissions.name` is the string the code checks; `permissions.id` is
-- what `role_permissions` FKs to AND what `role.permissions_set` audit
-- rows carry in their `permissionIds` metadata. So a rename is a single
-- UPDATE on `name` with the `perm_*` id left alone: every delegated
-- grant survives, and audit history stays resolvable. Renaming the ids
-- too would force the 0059-style copy-then-delete dance and orphan
-- every `permissionIds` array already written to `audit_log`.
--
--   feedback:submit  → site_feedback:submit   (pairs with club_feedback:*)
--   feedback:manage  → site_feedback:manage
--   landing:edit     → landing:manage         (only `:edit` in the system)
--
-- ── Splits ────────────────────────────────────────────────────────────
--   waivers:view  — read the attestation queue, per-member history, and
--                   the waiver-status badge on member detail, WITHOUT the
--                   authority to attest or revoke. Exec members who need
--                   to answer "is this person covered?" no longer need
--                   the attestation power to do it. No PDF is ever
--                   stored (Bylaw 1.3 keeps it with the Treasurer), so
--                   this grant exposes no PII beyond membership status.
--   gear:inspect  — record an append-only inspection (pass/fail/advisory)
--                   without full catalog CRUD, so a trip leader can log
--                   "this rope failed" without the power to retire gear
--                   or bulk-import inventory.
--
-- Both are checked with an OR against the wider permission in code
-- (`requireWaiverViewer` / `requireGearInspector`), so existing
-- `waivers:verify` and `gear:manage` holders keep working. The explicit
-- `waivers:view` grants below exist so /access shows the truth rather
-- than an invisible implication.

UPDATE permissions
   SET name = 'site_feedback:submit',
       description = 'Open the site feedback form and view your own submissions'
 WHERE id = 'perm_feedback_submit';
--> statement-breakpoint

UPDATE permissions
   SET name = 'site_feedback:manage',
       description = 'Triage site feedback: change status, view all submissions'
 WHERE id = 'perm_feedback_manage';
--> statement-breakpoint

UPDATE permissions
   SET name = 'landing:manage'
 WHERE id = 'perm_landing_edit';
--> statement-breakpoint

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_waivers_view',
   'waivers:view',
   'See waiver attestation status, the outstanding-attestation queue, and a member''s attestation history (read-only)'),
  ('perm_gear_inspect',
   'gear:inspect',
   'Record gear inspections (pass / fail / advisory) without full inventory management');
--> statement-breakpoint

-- President + Treasurer already hold `waivers:verify`; granting the view
-- permission alongside it keeps the /access grid honest. Advisor is a
-- read-only oversight role (Clery/CSA reporter) that already holds
-- `audit:view`, so waiver-compliance visibility is squarely its job.
-- `gear:inspect` gets no default grants — it exists to be delegated,
-- and `gear:manage` holders can already inspect via the OR-check.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_president', 'perm_waivers_view'),
  ('role_treasurer', 'perm_waivers_view'),
  ('role_advisor',   'perm_waivers_view');
--> statement-breakpoint

-- Migration 0063 renamed the page flag `feedback_website` → `feedback_site`,
-- leaving this feature flag as the last surface still saying "website".
-- `OR IGNORE` because `key` is the primary key: if a `feedback.site_enabled`
-- row somehow already exists, keep it rather than failing the migration.
-- A missing row is fine either way — settings reads fail open to the
-- registry default.
UPDATE OR IGNORE site_settings
   SET key = 'feedback.site_enabled'
 WHERE key = 'feedback.website_enabled';
--> statement-breakpoint

-- Carry the setting's history across with it. `settings_updated` audit
-- rows key on the setting name (`target_id = <key>`), so without this the
-- per-setting history panel in /settings comes back empty for a switch
-- that has in fact been toggled. Migrations 0061 and 0063 pair every
-- `site_settings` key rename with exactly this statement.
UPDATE audit_log
   SET target_id = 'feedback.site_enabled'
 WHERE action = 'settings_updated'
   AND target_id = 'feedback.website_enabled';
