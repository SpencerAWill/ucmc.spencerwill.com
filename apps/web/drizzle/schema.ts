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

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    email: text("email").notNull(),
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
    lastReadAnnouncementsAt: timestamp("last_read_announcements_at"),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
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

export const magicLinkIntent = ["register", "login"] as const;
export type MagicLinkIntent = (typeof magicLinkIntent)[number];

// Stores SHA-256 hash of the token (base64url), never the raw token.
// Atomic single-use is enforced via `UPDATE ... WHERE consumed_at IS NULL`.
export const magicLinks = sqliteTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  intent: text("intent", { enum: magicLinkIntent }).notNull(),
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
 * **One exception:** `member.self_deleted` deliberately captures the
 * deleting user's `email + userId` in `metadata` because the FK
 * cascade nulls both `actor_user_id` and `target_user_id` on the same
 * row. Without that exception the audit row would survive with no
 * way to identify the account, defeating the audit's whole purpose.
 * No other action type follows this pattern; the helper module
 * doc-comment in `src/server/audit/audit-log.server.ts` is the
 * canonical statement of the rule.
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

export const feedbackKind = ["bug", "feature", "general", "question"] as const;
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

export type User = typeof users.$inferSelect;
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
