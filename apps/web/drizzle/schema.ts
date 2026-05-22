// Define Drizzle table schemas here.
// After edits, run: pnpm --filter ucmc-web db:generate
// See: https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const userStatus = [
  "pending",
  "approved",
  "rejected",
  "deactivated",
  // Officer-pre-added stub: a real-world member who has gear out (or
  // similar off-platform association) but has not yet claimed the
  // account by completing a magic-link round-trip + profile submit.
  // Excluded from member directory, RBAC role-assign, waiver queue,
  // and registration approval queue. `placeholderName` + `unclaimedAt`
  // below are populated for these rows; `user_emails.verifiedAt` is
  // NULL until the person claims. On claim, status flips to "approved"
  // (officer pre-add IS the approval signal) and the placeholder
  // columns are NULLed; `profiles.fullName` then owns the display name.
  "unclaimed",
] as const;
export type UserStatus = (typeof userStatus)[number];

export const ucAffiliation = [
  "student",
  "faculty",
  "staff",
  "alum",
  "community",
] as const;
export type UcAffiliation = (typeof ucAffiliation)[number];

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  status: text("status", { enum: userStatus }).notNull().default("pending"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by"),
  // Set when an approver clicks Reject. Drives the retention cron's
  // 30-day rejected-registration purge. NULL on rows that pre-date
  // this column — the cron skips NULL so historical rejections never
  // auto-purge retroactively; an admin can clean those up by hand.
  rejectedAt: timestamp("rejected_at"),
  // Set when a member is deactivated. Drives the 12-month
  // deactivated-account purge. Same NULL-skip rule.
  deactivatedAt: timestamp("deactivated_at"),
  // Display-name placeholder captured at officer pre-add time. NULL for
  // every status other than `"unclaimed"`. NULLed on claim — the
  // freshly-inserted `profiles.fullName` takes over.
  placeholderName: text("placeholder_name"),
  // Stamped when an officer pre-adds the user. NULL for all
  // non-unclaimed rows. Mirrors the pattern of `rejectedAt` /
  // `deactivatedAt`. A future retention cron can purge stale stubs by
  // filtering `status = 'unclaimed' AND unclaimed_at < cutoff`.
  unclaimedAt: timestamp("unclaimed_at"),
  lastReadAnnouncementsAt: timestamp("last_read_announcements_at"),
});

/**
 * A user's verified email addresses. Every user has ≥1 row; exactly
 * one row per user is `is_primary = 1` (enforced by the partial unique
 * index below). The primary email is the "outbound + display" address
 * used for transactional mail, the WebAuthn RP `userName`, audit
 * snapshots, and member-directory listings.
 *
 * Email uniqueness is **global** across all users — an address can
 * belong to at most one account at any time. Sign-in lookups join
 * through this table, so any verified address can receive a magic
 * link that lands in the owning user's account. Adding an additional
 * email requires the user to be approved (`requireApproved`) and to
 * complete a magic-link round-trip to the new address; the row is
 * inserted with `verified_at = now` only after that round-trip
 * succeeds.
 *
 * Removal is unrestricted *except* that (a) the primary cannot be
 * removed without first promoting another row, and (b) the last
 * remaining row cannot be removed (there must always be ≥1 email).
 */
export const userEmails = sqliteTable(
  "user_emails",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Stored normalized: `trim().toLowerCase()`. The shared helper at
    // `#/server/auth/email-normalize` is the single source of truth;
    // every insert + lookup must go through it so the unique index
    // matches.
    email: text("email").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    // Nullable to support the officer pre-add path: an unclaimed user's
    // primary email row is created with `verifiedAt = NULL` (we have
    // the address on file but have not round-tripped a magic link to
    // it yet). When the real person clicks their first magic link, the
    // consume handler stamps `verifiedAt = now()`. Every other write
    // site (self-registration, add-email round-trip) sets a non-null
    // value at insert time, so any NULL in this column means
    // "officer-pre-added, not yet claimed."
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("user_emails_email_unique").on(t.email),
    // Partial unique enforces "exactly one primary per user" without
    // blocking the many non-primary rows. SQLite/D1 supports partial
    // indexes; if drizzle-kit ever drops the WHERE clause from a
    // generated migration, hand-edit the .sql to restore it.
    uniqueIndex("user_emails_one_primary_per_user")
      .on(t.userId)
      .where(sql`${t.isPrimary} = 1`),
    index("user_emails_user_id_idx").on(t.userId),
  ],
);

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  preferredName: text("preferred_name").notNull(),
  phone: text("phone").notNull(),
  ucAffiliation: text("uc_affiliation", { enum: ucAffiliation }).notNull(),
  avatarKey: text("avatar_key"),
  bio: text("bio"),
  // Acknowledgment of UCMC's anti-hazing + non-discrimination policies,
  // captured at registration as a single checkbox. Bumping
  // POLICIES_VERSION (in `#/config/legal`) invalidates prior
  // acknowledgments and forces re-ack on next sign-in.
  policiesAcknowledgedAt: timestamp("policies_acknowledged_at"),
  policiesVersion: text("policies_version"),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const contactRelationship = [
  "parent",
  "spouse_partner",
  "sibling",
  "friend",
  "other",
] as const;
export type ContactRelationship = (typeof contactRelationship)[number];

export const emergencyContacts = sqliteTable("emergency_contacts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  relationship: text("relationship", { enum: contactRelationship }).notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    // Identifier-style slug, regex-constrained at the API layer
    // (^[a-z][a-z0-9_]*$). Stable; never user-facing.
    name: text("name").notNull(),
    // Human-readable label shown wherever the role is presented to a
    // user (role editor, member detail, landing "Meet the officers"
    // section). Enforced non-empty by the editor; the migration
    // backfilled existing rows.
    displayName: text("display_name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    // When true, members assigned to this role surface on the public
    // home page's "Meet the officers" section. Toggled in the role
    // editor; no other behavior keys off this flag.
    isOfficer: integer("is_officer", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [uniqueIndex("roles_name_unique").on(t.name)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("permissions_name_unique").on(t.name)],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/**
 * Officer attestation that a member's *paper* signed waiver is on file
 * for a given academic cycle. The signed PDF lives off-platform with
 * the Treasurer (Bylaw 1.3); this table only records that an officer
 * confirmed receipt — no medical PII, no signature image, no R2 object.
 *
 * One row per attestation event. A `revokedAt` is set when an officer
 * needs to undo a mistaken attestation (the row stays for audit). The
 * `requireCurrentWaiver` guard looks for any non-revoked row where
 * `cycle = currentWaiverCycle()` and `version = WAIVER_VERSION`.
 */
export const waiverAttestations = sqliteTable(
  "waiver_attestations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "YYYY-YY" — see `#/config/waiver-cycle`.
    cycle: text("cycle").notNull(),
    // Tied to the canonical waiver PDF filename — see WAIVER_VERSION
    // in `#/config/legal`. Bumping forces re-attestation under the new
    // PDF even if the cycle hasn't rolled.
    version: text("version").notNull(),
    attestedAt: timestamp("attested_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // Officer who attested. Nullable + ON DELETE SET NULL so an officer
    // who has attested another member's waiver can later self-delete
    // without an FK violation. The attestation row survives (audit
    // trail), it just loses the officer's identity. Mirrors the
    // pattern `announcements.created_by` already uses.
    attestedBy: text("attested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at"),
    // Same pattern: nullable already, just adds the SET NULL clause.
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revocationReason: text("revocation_reason"),
    notes: text("notes"),
  },
  (t) => [
    // (userId, cycle) supports per-user lookups: the
    // `requireCurrentWaiver` guard, member history, and admin "show
    // me Y's attestations" reads.
    index("waiver_attestations_user_cycle").on(t.userId, t.cycle),
    // (cycle, version, revokedAt) supports the officer-queue
    // anti-join subquery that finds approved users *without* a
    // current attestation. The query filters on (cycle, version)
    // first, then on `revoked_at IS NULL`, so an index in that
    // column order avoids a full-table scan as the attestation
    // history grows year over year.
    index("waiver_attestations_cycle_version_revoked").on(
      t.cycle,
      t.version,
      t.revokedAt,
    ),
  ],
);

export const passkeyCredentials = sqliteTable(
  "passkey_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports"),
    nickname: text("nickname"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: timestamp("last_used_at"),
  },
  (t) => [uniqueIndex("passkey_credential_id_unique").on(t.credentialId)],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const magicLinkIntent = ["register", "login", "add_email"] as const;
export type MagicLinkIntent = (typeof magicLinkIntent)[number];

// Stores SHA-256 hash of the token (base64url), never the raw token.
// Atomic single-use is enforced via `UPDATE ... WHERE consumed_at IS NULL`.
export const magicLinks = sqliteTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  intent: text("intent", { enum: magicLinkIntent }).notNull(),
  // Populated only for `intent = "add_email"`. The consume handler
  // asserts `session.userId === targetUserId` so an attacker can't
  // request a link to a victim's address and then have the victim
  // (signed in as themselves) attach the email to the attacker's
  // account by clicking the link. SET NULL on user delete keeps the
  // historical row.
  targetUserId: text("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
});

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("announcements_published_at_idx").on(t.publishedAt)],
);

// Singleton key/value store for editable landing-page text. One row per
// well-known key (e.g. "hero.heading", "about.paragraphs"). Values are JSON
// so list-shaped settings (about paragraphs) and scalar strings can share
// the same shape.
export const landingSettings = sqliteTable("landing_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

// Singleton key/value store for runtime-editable site settings + feature
// flags. Distinct from `landing_settings` (the homepage CMS) — this one
// holds cross-cutting platform configuration. Schemas + defaults live in
// `features/settings/server/settings-registry.ts`; that registry is the
// only thing that knows what shapes are legal in `value_json`.
export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const landingHeroSlides = sqliteTable(
  "landing_hero_slides",
  {
    id: text("id").primaryKey(),
    imageKey: text("image_key").notNull(),
    alt: text("alt").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("landing_hero_slides_sort_idx").on(t.sortOrder)],
);

export const landingFaqItems = sqliteTable(
  "landing_faq_items",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("landing_faq_items_sort_idx").on(t.sortOrder)],
);

export const landingActivities = sqliteTable(
  "landing_activities",
  {
    id: text("id").primaryKey(),
    icon: text("icon").notNull(),
    title: text("title").notNull(),
    blurb: text("blurb").notNull(),
    // Optional R2 key (under `landing/activities/`). When present, the
    // section component reveals the image on hover/tap.
    imageKey: text("image_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("landing_activities_sort_idx").on(t.sortOrder)],
);

/**
 * Append-only audit log of admin / officer actions. Constitutionally
 * load-bearing now that the retention cron auto-deletes user rows: a
 * member rejected for cause and then purged 30 days later leaves zero
 * trace anywhere else; the audit row is the only surviving record of
 * who did what.
 *
 * **Append-only.** Nothing in the app is allowed to UPDATE or DELETE
 * rows here. The retention cron explicitly skips this table. If a
 * particular event needs to be redacted (e.g. legal hold lifted),
 * that's a manual SQL operation, not a feature.
 *
 * **PII discipline.** `metadata_json` is for non-PII context only —
 * role names, status transitions, decision text, counts. Identifying
 * info (email, phone, full name) is reachable via the `actor_user_id`
 * / `target_user_id` FKs while those rows still exist; once they're
 * hard-deleted, the SET NULL preserves the action's existence without
 * leaking PII through this surface. Never put email/phone/name in the
 * JSON blob.
 *
 * **Documented exceptions** — actions that intentionally capture an
 * email value in metadata, with rationale:
 *
 *   - `member.self_deleted` — captures `{ userId, email }` (primary
 *     email at deletion time). The FK cascade nulls both
 *     `actor_user_id` and `target_user_id` on the same row, so without
 *     the metadata snapshot the audit row would survive with no way
 *     to identify whose account was deleted. Only the primary is
 *     captured (additional emails would balloon the row and aren't
 *     needed for "who was this account").
 *   - `email.added`, `email.removed`, `email.primary_changed` —
 *     capture `{ email }`, which IS the load-bearing detail of the
 *     action. The actor and target FKs both point at the same user
 *     (the user managing their own email list), so the FK alone tells
 *     you "user X did something to their emails" without revealing
 *     *which* address. Including the address keeps these rows
 *     useful for incident review (e.g. correlating a hijacked alt
 *     email back to the user) without expanding the surface beyond
 *     what was already exposed when the event happened.
 *   - `member.pre_added`, `member.unclaimed_edited`,
 *     `member.unclaimed_deleted` — capture `{ email, placeholderName }`
 *     (and `{ before, after }` for the edit case). These are
 *     officer-initiated lifecycle events on stub user rows that may
 *     never get a profile (if the person never claims). The audit row
 *     IS the source of truth for "who did the officer add and when";
 *     the FK to the unclaimed `users.id` is the only other handle on
 *     the stub, and a future retention sweep that purges abandoned
 *     stubs would null both FKs, leaving the metadata as the only
 *     surviving identifier.
 *
 * No other action type follows this pattern; the helper module
 * doc-comment in `src/server/audit/audit-log.server.ts` is the
 * canonical statement of the rule. The audit-page UI must not render
 * `metadata.email` for any other action.
 *
 * Adding a new action here requires it to actually be written by some
 * code path — empty enum entries pollute the viewer's filter UI.
 */
export const auditAction = [
  // Membership lifecycle (status transitions on `users`).
  "registration.approved",
  "registration.rejected",
  "registration.unrejected",
  "member.deactivated",
  "member.reactivated",
  "member.self_deleted",
  // Officer-initiated termination of another member's active
  // sessions. Distinct from deactivation (which terminates sessions
  // as a side effect of the status change) — this one keeps the
  // member approved.
  "member.sessions_revoked",
  "profile.force_edited",
  // Email-address lifecycle. The user (or in rare cases an admin via
  // future tooling) added a verified address, removed one, or promoted
  // a non-primary to primary. `actor_user_id` and `target_user_id` are
  // the same on user-self actions; metadata captures the email value
  // so the row remains useful even after a future cascade.
  "email.added",
  "email.removed",
  "email.primary_changed",
  // RBAC.
  "role.created",
  "role.updated",
  "role.deleted",
  "role.permissions_set",
  "role.assigned",
  "role.unassigned",
  // Waivers — paper attestations are constitutionally significant.
  "waiver.attested",
  "waiver.revoked",
  // Landing-page edits — officer-published club voice; worth a record.
  "landing.settings_edited",
  "landing.hero_slide_edited",
  "landing.activity_edited",
  "landing.faq_edited",
  // Officer pre-adds a stub user (name + email) so off-platform
  // associations like gear holdings can FK to a stable users.id before
  // the person ever signs in. Metadata: { email, placeholderName }.
  // Listed at the end (rather than grouped with the other membership-
  // lifecycle entries above) so the audit page's filter dropdown order
  // mirrors `AUDIT_ACTIONS` in `features/audit/server/audit-fns.ts` —
  // existing officers' muscle memory survives the new feature.
  "member.pre_added",
  "member.unclaimed_edited",
  "member.unclaimed_deleted",
  // The unclaimed user clicked their first magic link and submitted a
  // profile, claiming the row. Status flips from "unclaimed" to
  // "approved" in the same step (officer pre-add was the approval
  // signal). Actor + target are the same user.
  "member.claimed",
  // Gear inventory lifecycle. The `code` (CH93, LJ4 etc.) lives on the
  // physical tag; on retirement we NULL the column so the string can be
  // reissued to a new piece. `gear.retired` captures the priorCode so
  // the audit row remains useful after recycling. `gear.updated` carries
  // changedFields plus old/new code values when the rename was a code
  // edit. Metadata is non-PII (typeId, code, changedFields, reason).
  "gear.added",
  "gear.updated",
  "gear.retired",
  "gear.unretired",
  "gear.tags_changed",
  "gear_type.created",
  "gear_type.updated",
  "gear_type.deleted",
  "gear_tag.created",
  "gear_tag.updated",
  "gear_tag.deleted",
  "gear_inspection.recorded",
  // Gear loans / checkout. A "loan" is a per-piece row in `gear_loans`;
  // a single officer-driven checkout flow generates N loans, one per
  // gear piece — emit one event per row so the audit page filters
  // remain per-target. Group by `actor_user_id + checked_out_at` to
  // reconstruct a checkout batch. Check-in batches may span multiple
  // borrowers; each row's event still keys on `target_id = gear.id`.
  "loan.checked_out",
  "loan.checked_in",
  "loan.extended",
  // Site settings / feature-flag edits via /settings. One action covers
  // both scalar settings and boolean flags — the metadata payload
  // distinguishes them. For boolean values metadata is { key, value };
  // for any other shape metadata is { key } only, to avoid leaking
  // freeform values (emails, URLs, JSON blobs) into the audit log.
  "settings_updated",
  // /history edits via the history:manage edit affordance. The
  // narrative-update event carries only `markdownLength` to keep the
  // audit row bounded (the markdown itself is public anyway, but we
  // don't want to balloon the audit table on every edit). Officer
  // and honorary mutations carry only `schoolYear`/`role`/`name` —
  // enough context to follow a "who edited what" trail without
  // duplicating the row's contents.
  // Legacy: narrative-only updates before the markdown_pages
  // generalization. Kept in the enum so older audit rows still
  // surface in the viewer; no new code emits this — see
  // `markdown_page.updated` below.
  "history.narrative_updated",
  // Generalized public-page markdown edit. One event per save with
  // { slug, markdownLength } metadata. Slug is the row key in
  // markdown_pages (history.narrative, policies, scholarships,
  // gear_cave, resources).
  "markdown_page.updated",
  "historical_officer.created",
  "historical_officer.updated",
  "historical_officer.deleted",
  // Bulk deletion of every officer entry for one school year. One
  // event per year-delete (not one per row) with metadata carrying
  // the schoolYear and how many rows were removed — that's enough
  // context to follow a "who wiped 2022-23?" trail without flooding
  // the audit log with five identical-looking rows on one click.
  "historical_officer.year_deleted",
  "honorary_member.created",
  "honorary_member.updated",
  "honorary_member.deleted",
  // Bulk reorder of the honorary-members list via drag-and-drop in
  // /history's manage UI. One audit event per reorder action with
  // metadata { count } — we deliberately don't log the full id ordering
  // because each row's new sort_order is implicit in the index it
  // landed at after batch update.
  "honorary_member.reordered",
  // Goosedown Gazette issue CRUD via /gazette manage affordances.
  // Metadata carries { schoolYear, issueNumber, title } so the audit
  // page surfaces enough context to follow "who uploaded what" without
  // chasing the issue row (which may have been deleted by the time
  // the audit is reviewed).
  "gazette_issue.created",
  "gazette_issue.updated",
  "gazette_issue.deleted",
  // Trip Gallery photo CRUD via /gallery manage affordances.
  // Metadata carries { caption, tag } so the audit row stays
  // informative even after the photo row is deleted.
  "gallery_photo.created",
  "gallery_photo.updated",
  "gallery_photo.deleted",
] as const;
export type AuditAction = (typeof auditAction)[number];

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    // Actor (the user who performed the action). Nullable + SET NULL
    // so an admin who has audit rows can later self-delete without
    // FK violation; the row survives, just loses the actor identity.
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action", { enum: auditAction }).notNull(),
    // The common case is a user-targeted action (approve / reject /
    // role assignment). Typed FK so we can join when present.
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // For non-user targets — role IDs, landing setting keys,
    // announcement IDs. Loose `text` because the universe of types
    // grows as features land; the action enum disambiguates.
    targetType: text("target_type"),
    targetId: text("target_id"),
    // Non-PII context only. See the table doc-comment.
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Default chronological view (newest first) on the audit page.
    index("audit_log_created_at_idx").on(t.createdAt),
    // "What did this admin do?" / "What happened to this member?" —
    // both common questions when investigating an incident.
    index("audit_log_actor_idx").on(t.actorUserId),
    index("audit_log_target_user_idx").on(t.targetUserId),
    index("audit_log_action_idx").on(t.action),
  ],
);

export const feedbackKind = ["bug", "feature", "general"] as const;
export type FeedbackKind = (typeof feedbackKind)[number];

export const feedbackStatus = [
  "open",
  "acknowledged",
  "resolved",
  "closed",
] as const;
export type FeedbackStatus = (typeof feedbackStatus)[number];

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: feedbackKind }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: feedbackStatus }).notNull().default("open"),
    pageUrl: text("page_url"),
    userAgent: text("user_agent"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueUrl: text("github_issue_url"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("feedback_status_created_at_idx").on(t.status, t.createdAt),
    index("feedback_created_by_idx").on(t.createdBy),
  ],
);

// ── Club feedback ───────────────────────────────────────────────────────
//
// Parallel surface to `feedback` aimed at exec-board governance instead
// of website maintainers. Intentionally separate table because the two
// have different lifecycles, different triage audiences, and different
// taxonomies — and because club feedback must NEVER mirror to GitHub.
//
// Kinds drop "bug" (not a defect tracker) and add "praise" + "concern"
// + "suggestion" alongside "general". Statuses are reused from the
// website-feedback enum (open → acknowledged → resolved/closed) since
// the triage workflow is the same shape.
//
// Anonymity: `createdBy` is always set when known so the per-user rate
// limit + abuse handling work, but `anonymous = 1` causes the admin
// triage view to redact the submitter (the repo + actions layers strip
// the joined user info server-side — clients never see the FK). Owners
// always see their own submissions un-redacted.
//
// Omitted vs. `feedback`: `pageUrl`, `userAgent`, GitHub mirror columns
// — none are meaningful for club feedback.
export const clubFeedbackKind = [
  "suggestion",
  "concern",
  "praise",
  "general",
] as const;
export type ClubFeedbackKind = (typeof clubFeedbackKind)[number];

// Reuse the same status taxonomy as website feedback — the triage
// workflow is identical even if the audiences differ.
export const clubFeedbackStatus = feedbackStatus;
export type ClubFeedbackStatus = FeedbackStatus;

export const clubFeedback = sqliteTable(
  "club_feedback",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: clubFeedbackKind }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: clubFeedbackStatus })
      .notNull()
      .default("open"),
    // 1 = submitter asked to be hidden from officers in the triage view.
    // The FK below is still set when known so per-user rate limiting
    // and abuse handling stay possible.
    anonymous: integer("anonymous", { mode: "boolean" })
      .notNull()
      .default(false),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("club_feedback_status_created_at_idx").on(t.status, t.createdAt),
    index("club_feedback_created_by_idx").on(t.createdBy),
  ],
);

/**
 * Gear inventory.
 *
 * Each piece of gear the club owns gets one row in `gear`. Pieces are
 * **exclusively** partitioned by type (`gear_types`) — climbing harness,
 * life jacket, etc. — and tagged with zero or more non-exclusive labels
 * via `gear_tag_assignments`.
 *
 * The `code` column is the human-and-scanner-friendly identifier
 * printed on the laminated tag stuck to the physical item (e.g. "CH93",
 * "LJ4"). It is freeform text — conventions like "type-prefix + number"
 * exist for officers' convenience but are not enforced by the schema.
 *
 * **Code recycling.** `code` is nullable and `UNIQUE` (SQLite allows
 * multiple NULLs in a unique column). When a piece of gear is retired,
 * the retire action NULLs `code`, freeing the string to be reissued to
 * a newer piece. The historical value is captured in the `gear.retired`
 * audit row's metadata (`{ priorCode, reason }`) so the lineage
 * survives.
 *
 * **Lifecycle vs condition** are two orthogonal columns:
 *
 *   - `lifecycle` — `"active"` or `"retired"`. Terminal: retiring is
 *     conceptually "this physical item is gone from inventory". A
 *     follow-up `gear.unretired` exists for officer-correction of a
 *     mistaken retirement (rare).
 *   - `condition` — `"serviceable"`, `"needs_repair"`, `"missing"`, or
 *     `"lost"`. Transient state, separate from lifecycle so a piece can
 *     be `lifecycle=active, condition=missing` (we expect it back) vs
 *     `lifecycle=retired` (gone for good).
 *
 * Future loan/checkout work will land as a separate `gear_loans` table
 * keyed on `gear.id`; checkout state is intentionally **not** modeled
 * on these columns.
 */
export const gearLifecycle = ["active", "retired"] as const;
export type GearLifecycle = (typeof gearLifecycle)[number];

export const gearCondition = [
  "serviceable",
  "needs_repair",
  "missing",
  "lost",
] as const;
export type GearCondition = (typeof gearCondition)[number];

/**
 * Optional wear-level grade independent of {@link gearCondition}.
 *
 * `condition` is operational state ("can this be loaned out?"); the
 * grade is a coarse subjective wear assessment carried over from
 * legacy paper inventories. A piece can be `condition=serviceable,
 * conditionGrade=fair` (loanable but visibly worn) or
 * `condition=needs_repair, conditionGrade=excellent` (only just
 * developed a defect on a near-new item).
 */
export const gearConditionGrade = ["excellent", "good", "fair"] as const;
export type GearConditionGrade = (typeof gearConditionGrade)[number];

export const gearTypes = sqliteTable(
  "gear_types",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    // Display-only convention hint (e.g. "CH" for Climbing Harness).
    // NOT enforced against gear.code — officers may give a piece any
    // code regardless of its type's prefix. The create-gear UI uses
    // this only to seed a "Suggested: CH4" auto-fill.
    prefix: text("prefix"),
    description: text("description"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("gear_types_name_unique").on(t.name)],
);

export const gear = sqliteTable(
  "gear",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    // RESTRICT delete: a type can't be removed while any gear (active
    // or retired) references it. Officers must merge/relabel first.
    typeId: text("type_id")
      .notNull()
      .references(() => gearTypes.id, { onDelete: "restrict" }),
    // Freeform tag label e.g. "CH93". NULL on retired gear (NULLed by
    // the retire action) and on un-coded active gear (fresh-in-box not
    // yet labeled). The plain UNIQUE constraint relies on SQLite's
    // multiple-NULL-allowed semantics for the recycling story.
    code: text("code"),
    description: text("description").notNull(),
    // R2 key under `gear/<contentHash>.<ext>` for the per-gear
    // thumbnail. NULL when the officer hasn't uploaded one — the card
    // falls back to the generic placeholder SVG in that case.
    // Content-hashed key means the URL is immutable across edits, so
    // the public bucket can serve with `Cache-Control: immutable`.
    thumbnailKey: text("thumbnail_key"),
    acquiredAt: timestamp("acquired_at"),
    acquisitionCostCents: integer("acquisition_cost_cents"),
    // Manufacturer's listed retail price at acquisition, in cents.
    // Separate from `acquisitionCostCents` so the club can report
    // replacement value for pieces that were donated or bought at
    // steep discount.
    msrpCents: integer("msrp_cents"),
    manufacturer: text("manufacturer"),
    serialNumber: text("serial_number"),
    conditionGrade: text("condition_grade", { enum: gearConditionGrade }),
    notesMarkdown: text("notes_markdown"),
    lifecycle: text("lifecycle", { enum: gearLifecycle })
      .notNull()
      .default("active"),
    condition: text("condition", { enum: gearCondition })
      .notNull()
      .default("serviceable"),
    retiredAt: timestamp("retired_at"),
    retiredBy: text("retired_by").references(() => users.id, {
      onDelete: "set null",
    }),
    retiredReason: text("retired_reason"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("gear_code_unique").on(t.code),
    index("gear_type_idx").on(t.typeId),
    index("gear_lifecycle_idx").on(t.lifecycle),
    index("gear_condition_idx").on(t.condition),
    index("gear_created_at_idx").on(t.createdAt),
  ],
);

/**
 * Tag visibility scope. `public` tags are visible to anyone with
 * `gear:read`; `internal` tags only render for `gear:manage` officers
 * — both in the multiselect surfaces and on the gear card/detail
 * read paths. Used for exec-only annotations like "needs-inspection"
 * or "checked-out-to-treasurer" that shouldn't leak to general
 * members.
 */
export const gearTagVisibility = ["public", "internal"] as const;
export type GearTagVisibility = (typeof gearTagVisibility)[number];

export const gearTags = sqliteTable(
  "gear_tags",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    visibility: text("visibility", { enum: gearTagVisibility })
      .notNull()
      .default("public"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("gear_tags_name_unique").on(t.name)],
);

/**
 * Per-piece inspection log. Climbing gear (harnesses, ropes, helmets,
 * draws) has real safety stakes and is typically inspected on a
 * cadence; this table records each inspection event so the detail
 * page can surface history and a future report can flag "due for
 * inspection" pieces.
 *
 * Append-mostly. Officers can correct a mistaken entry by recording
 * a superseding inspection, but the historical row stays. This
 * mirrors the audit-log philosophy: the only safe way to reason
 * about gear safety later is if the trail is intact.
 *
 * Cascade on gear delete: when a piece is hard-deleted, its
 * inspection history goes with it. Retirement does NOT delete
 * inspections — the row stays so a future "why did we retire this?"
 * audit can pull the failing inspection alongside the gear.retired
 * audit event.
 */
export const gearInspectionResult = ["pass", "fail", "advisory"] as const;
export type GearInspectionResult = (typeof gearInspectionResult)[number];

export const gearInspections = sqliteTable(
  "gear_inspections",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    gearId: text("gear_id")
      .notNull()
      .references(() => gear.id, { onDelete: "cascade" }),
    // Inspector keeps SET NULL on user delete so the inspection
    // history survives an officer leaving the club. The
    // `inspectorNameSnapshot` captures who it was at write time so
    // the historical row still reads usefully after the FK nulls.
    inspectorUserId: text("inspector_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    inspectorNameSnapshot: text("inspector_name_snapshot"),
    // When the inspection physically happened. Distinct from
    // `createdAt` because officers might log a past inspection (e.g.,
    // entering paper records into the system after a season).
    inspectedAt: timestamp("inspected_at").notNull(),
    result: text("result", { enum: gearInspectionResult }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("gear_inspections_gear_idx").on(t.gearId),
    // Compound index supports the "latest inspection per gear" query
    // — the detail page's history list and any future per-gear
    // latest-inspection summary both want gear_id, inspected_at DESC.
    index("gear_inspections_gear_inspected_idx").on(t.gearId, t.inspectedAt),
  ],
);

export const gearTagAssignments = sqliteTable(
  "gear_tag_assignments",
  {
    gearId: text("gear_id")
      .notNull()
      .references(() => gear.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => gearTags.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    assignedBy: text("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.gearId, t.tagId] }),
    index("gear_tag_assignments_tag_idx").on(t.tagId),
  ],
);

/**
 * A loan is a per-piece checkout: exactly one gear row linked to one
 * member, with its own due date and (eventually) returned timestamp.
 *
 * One officer-driven checkout batch generates N loan rows (one per
 * piece). Check-in batches may span multiple borrowers — each row's
 * member is derived from the open loan, not from a batch-level field.
 *
 * Concurrency: the partial unique on `(gear_id) WHERE returned_at IS
 * NULL` enforces "at most one open loan per piece" at the DB layer.
 * The action's per-row pre-check is a UX nicety; the index is what
 * actually wins races between two officers checking out the same
 * piece at the same instant.
 *
 * FK choices:
 *   - gear / member: RESTRICT — can't retire on-loan gear or delete a
 *     member account with open loans. The action layer surfaces this
 *     as a typed error, the FK is defense-in-depth.
 *   - checkedOutBy / returnedTo: SET NULL — officer accounts may come
 *     and go; closed-loan history survives them.
 */
export const gearLoans = sqliteTable(
  "gear_loans",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    gearId: text("gear_id")
      .notNull()
      .references(() => gear.id, { onDelete: "restrict" }),
    memberUserId: text("member_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    checkedOutByUserId: text("checked_out_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    checkedOutAt: timestamp("checked_out_at").notNull(),
    dueAt: timestamp("due_at").notNull(),
    returnedAt: timestamp("returned_at"),
    returnedToUserId: text("returned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    checkoutNotes: text("checkout_notes"),
    checkinNotes: text("checkin_notes"),
    // Optional snapshot of the gear's condition AT the moment of return.
    // The check-in flow may also update `gear.condition` directly when
    // an officer flags damage; this column is a per-loan record so the
    // history doesn't get rewritten by later condition changes.
    conditionAtReturn: text("condition_at_return", { enum: gearCondition }),
  },
  (t) => [
    // Race-protective: only one open loan per piece at any moment.
    // SQLite partial unique. Mirrors `user_emails_one_primary_per_user`.
    uniqueIndex("gear_loans_one_active_per_gear")
      .on(t.gearId)
      .where(sql`${t.returnedAt} IS NULL`),
    // Drives /my/gear (active + history per member).
    index("gear_loans_member_returned_idx").on(t.memberUserId, t.returnedAt),
    // Drives the "open loan for this gear" lookup on /gear/$publicId.
    index("gear_loans_gear_idx").on(t.gearId),
    // Drives the overdue list + due-date sort on /gear/loans.
    index("gear_loans_due_idx").on(t.dueAt),
  ],
);

export type User = typeof users.$inferSelect;
export type UserEmail = typeof userEmails.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type EmergencyContact = typeof emergencyContacts.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type MagicLink = typeof magicLinks.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type LandingSetting = typeof landingSettings.$inferSelect;
export type LandingHeroSlide = typeof landingHeroSlides.$inferSelect;
export type LandingFaqItem = typeof landingFaqItems.$inferSelect;
export type LandingActivity = typeof landingActivities.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type GearType = typeof gearTypes.$inferSelect;
export type Gear = typeof gear.$inferSelect;
export type GearTag = typeof gearTags.$inferSelect;
export type GearTagAssignment = typeof gearTagAssignments.$inferSelect;
export type GearInspection = typeof gearInspections.$inferSelect;
export type GearLoan = typeof gearLoans.$inferSelect;

/**
 * Historical archive of past UCMC officer rosters, one row per
 * (school_year, role, name). Distinct from the live officer list on
 * the landing page (which renders the *current* exec board): this
 * table is an immutable-feeling record of who held what role in past
 * years, ported from the legacy Weebly site and editable directly in
 * D1 for corrections.
 *
 * Roles are intentionally free-form text rather than an enum because
 * the club's role set has drifted over the decades — "Librarian"
 * existed in the 1970s but isn't current; "Trip Coordinator" was added
 * mid-2000s; "Gear Assistants" came in the 2010s and is plural. Pinning
 * to today's roles would falsify the historical record.
 *
 * `name` is also free-form (not a FK to `users`) so it can carry
 * mid-year transitions like "Tom Bailey (Fall) / Steve Kramrech" that
 * appeared verbatim on the legacy site. Most names belong to alumni
 * who never had a portal account; FK-ing them would force fake stubs.
 *
 * `startYear` gates the display sort (oldest first or newest first);
 * `roleOrder` controls within-year order (President → VP → Treasurer
 * → Secretary → Trip Coordinator → Equipment Manager → others).
 */
export const historicalOfficers = sqliteTable(
  "historical_officers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    schoolYear: text("school_year").notNull(),
    startYear: integer("start_year").notNull(),
    role: text("role").notNull(),
    roleOrder: integer("role_order").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("historical_officers_year_idx").on(t.startYear, t.roleOrder)],
);

/**
 * Honorary UCMC members — a flat list ported from the legacy Weebly
 * site. Honorary membership is granted by majority vote per
 * Constitution §3.4; the list is small and changes rarely. `sortOrder`
 * preserves the canonical legacy ordering; alphabetical sort can be
 * applied at the view layer instead if/when that's preferred.
 */
export const honoraryMembers = sqliteTable(
  "honorary_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("honorary_members_sort_idx").on(t.sortOrder)],
);

export type HistoricalOfficer = typeof historicalOfficers.$inferSelect;
export type HonoraryMember = typeof honoraryMembers.$inferSelect;

/**
 * Slug enum for `markdown_pages`. Lives in the schema module so the
 * column type is narrowed everywhere drizzle is consumed; the matching
 * runtime permission map lives in `src/server/markdown-pages/slugs.ts`
 * (kept separate because the schema module is server-only and the
 * permission map needs to be importable from client-side route
 * guards). Adding a new editable public page is a four-line change:
 *   1. New string here.
 *   2. New entry in the permission map.
 *   3. New permissions seeded in a migration.
 *   4. Seed row inserted into markdown_pages.
 */
export const markdownPageSlug = [
  "history.narrative",
  "policies",
  "scholarships",
  "gear_cave",
  "resources",
] as const;
export type MarkdownPageSlug = (typeof markdownPageSlug)[number];

/**
 * Slug-keyed store for any public-facing markdown page whose content
 * is editable at runtime by a `*:manage` permission holder. Started
 * as a single-row `history_content` table, generalized in migration
 * 0049 to cover the rest of the editable public surface (policies,
 * scholarships, the gear-cave overview, resources).
 *
 * `updated_by` snapshot of users.id with SET NULL on delete so the
 * audit chain in `audit_log` survives an editor's account removal —
 * the page row stays even though the FK is nulled.
 */
export const markdownPages = sqliteTable("markdown_pages", {
  slug: text("slug", { enum: markdownPageSlug }).primaryKey(),
  markdown: text("markdown").notNull().default(""),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export type MarkdownPage = typeof markdownPages.$inferSelect;

/**
 * Goosedown Gazette — UCMC's club newsletter, archived by school year
 * and issue number. PDFs live in `BUCKET_PUBLIC` under
 * `gazette/<id>/<contentHash>.pdf`; the row stores the key plus
 * metadata (title, editor, published date, file size, description).
 *
 * Both `editor` and `publishedAt` are nullable so a future backfill
 * of the 1978–2020 legacy archive can land incomplete metadata
 * without schema changes — many old issues lack an exact date or a
 * recorded editor.
 *
 * `UNIQUE (school_year, issue_number)` is the de-dupe guard: a year
 * can't have two "Issue 1"s. The action layer surfaces the SQLite
 * uniqueness error cleanly to the UI.
 */
export const gazetteIssues = sqliteTable(
  "gazette_issues",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    schoolYear: text("school_year").notNull(),
    startYear: integer("start_year").notNull(),
    issueNumber: integer("issue_number").notNull(),
    title: text("title"),
    editor: text("editor"),
    publishedAt: timestamp("published_at"),
    description: text("description"),
    pdfKey: text("pdf_key").notNull(),
    pdfBytes: integer("pdf_bytes").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // Officer who first uploaded / most recently edited. SET NULL on
    // delete so the audit chain in audit_log survives the editor's
    // account removal.
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("gazette_issues_year_number_unique").on(
      t.schoolYear,
      t.issueNumber,
    ),
    // Drives the list query (newest year first, newest issue within
    // year first).
    index("gazette_issues_sort_idx").on(t.startYear, t.issueNumber),
  ],
);

export type GazetteIssue = typeof gazetteIssues.$inferSelect;

/**
 * Trip Gallery — UCMC's photo archive. Photos are cropped to a fixed
 * 4:3 ratio at upload time (`useImageCrop()` in the dialog → canvas
 * → WebP), so every grid tile is uniform. The cropped WebP is what
 * gets stored; the original is discarded after crop.
 *
 * Storage: `BUCKET_PUBLIC` at `gallery/<id>/<contentHash>.webp`.
 * Content-hashed keys mean `Cache-Control: immutable` is safe forever;
 * a replacement upload produces a new key and the row swaps.
 *
 * Layout: flat collection — no albums/trips entity in v1. Each photo
 * has caption, credit, `takenAt`, optional `tag`, and required
 * `altText` for accessibility (every gallery `<img>` MUST have alt
 * text; this is the SQL guard for it). Width/height columns are
 * stored even though the aspect is fixed so a future masonry layout
 * doesn't need a column-add migration.
 */
export const galleryPhotos = sqliteTable(
  "gallery_photos",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    caption: text("caption"),
    credit: text("credit"),
    takenAt: timestamp("taken_at"),
    tag: text("tag"),
    altText: text("alt_text").notNull(),
    imageKey: text("image_key").notNull(),
    imageBytes: integer("image_bytes").notNull(),
    widthPx: integer("width_px").notNull(),
    heightPx: integer("height_px").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // Drives the default list query (newest taken-date first).
    index("gallery_photos_taken_at_idx").on(t.takenAt),
    // Drives tag-filtered queries from the grid's tag dropdown.
    index("gallery_photos_tag_idx").on(t.tag),
  ],
);

export type GalleryPhoto = typeof galleryPhotos.$inferSelect;
