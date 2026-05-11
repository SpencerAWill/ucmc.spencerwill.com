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
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
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
  "gear_tag.deleted",
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
    description: text("description"),
    acquiredAt: timestamp("acquired_at"),
    acquisitionCostCents: integer("acquisition_cost_cents"),
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

export const gearTags = sqliteTable(
  "gear_tags",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("gear_tags_name_unique").on(t.name)],
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
