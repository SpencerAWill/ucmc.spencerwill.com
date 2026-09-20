// Define Drizzle table schemas here.
// After edits, run: pnpm --filter ucmc-web db:generate
// See: https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Epoch-milliseconds column that reads/writes as a `Temporal.Instant`.
 *
 * Stored on disk as an INTEGER (identical DDL to the former
 * `integer(name, { mode: "timestamp_ms" })`, so no migration), but the
 * ORM boundary maps it to/from `Temporal.Instant` — the app layer never
 * sees a raw `Date`. SQL-side defaults (`unixepoch() * 1000`) still apply;
 * `fromDriver` converts the integer that comes back on read.
 *
 * Query comparisons (`gte`/`lt`/…) accept a `Temporal.Instant` too —
 * Drizzle runs the bound value through `toDriver`.
 */
const instantMs = customType<{ data: Temporal.Instant; driverData: number }>({
  dataType: () => "integer",
  toDriver: (value) => value.epochMilliseconds,
  fromDriver: (value) => Temporal.Instant.fromEpochMilliseconds(value),
});

const timestamp = (name: string) => instantMs(name);

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

// Hero gallery slides for any page that renders a hero. Named
// `landing_hero_slides` until migration 0065, when seven more public
// pages gained one and the home page became just another `page` value —
// see `HERO_PAGES` in `features/landing/lib/hero-pages.ts`, which is the
// only place a page is named.
export const heroSlides = sqliteTable(
  "hero_slides",
  {
    id: text("id").primaryKey(),
    // Page slug from the `HERO_PAGES` registry (`home`, `gear_cave`, …).
    // Not a URL path, and not derived from one: it's persisted here and
    // embedded in `hero.<page>.*` setting keys, so renaming a slug is a
    // data migration.
    page: text("page").notNull().default("home"),
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
  // Leads with `page`: every read is scoped to one page and then
  // ordered, which a bare `sort_order` index can't serve.
  (t) => [index("hero_slides_page_sort_idx").on(t.page, t.sortOrder)],
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
  // Passkey (WebAuthn) credential lifecycle. Self-service, so
  // `actor_user_id` and `target_user_id` are the same user; `target_id`
  // is the credential's `passkey_credentials.id` (NOT the raw
  // `credential_id`, which is attacker-supplied base64url from the
  // authenticator and has no business in a log we render).
  //
  // Renames are audited even though a nickname is a cosmetic label with
  // no authentication effect — normally that would put them in the
  // "deliberately NOT audited" bucket above. The nickname is how a
  // member decides which credential to REVOKE, so someone holding a
  // stolen session could silently relabel passkeys to steer the victim
  // into deleting their own and keeping the attacker's. Metadata carries
  // `{ before, after }` so that relabelling is reconstructable. A
  // nickname is user-authored free text, not PII we derived, and it's
  // capped at 60 chars.
  "passkey.added",
  "passkey.removed",
  "passkey.renamed",
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
  "hero_slide.edited",
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
  // Superseded by `gear.deactivated` / `gear.reactivated` when the
  // status column gained `lost` and `disposed`. Retained so historical
  // rows still resolve; nothing emits them any more.
  "gear.retired",
  "gear.unretired",
  "gear.deactivated",
  "gear.reactivated",
  "gear.code_released",
  "gear.tags_changed",
  "gear_model.created",
  "gear_model.updated",
  "gear_model.deleted",
  "gear_model.stock_adjusted",
  "gear_stock.adjusted",
  "gear_hold.placed",
  "gear_hold.released",
  "gear_sweep.started",
  "gear_sweep.closed",
  "gear_attribute.created",
  "gear_attribute.updated",
  "gear_attribute.deleted",
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
  // Officer scanned a member's gear-cart QR at the checkout desk
  // (resolveCartTokenAction). One event per scan, with metadata
  // { memberUserId, itemCount } so the audit trail captures officer
  // interactions with members' carts independently of whether the
  // checkout itself was actually submitted.
  "loan.cart_scanned",
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
  // gear_cave, resources, volunteer).
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
  // Album photo CRUD via /album manage affordances.
  // Metadata carries { caption, tag } so the audit row stays
  // informative even after the photo row is deleted.
  "album_photo.created",
  "album_photo.updated",
  "album_photo.deleted",
  // /volunteer manage affordances. Opportunities are the standing
  // programs; events are dated outings. Metadata carries { title } (and
  // { startsAt } for events) so the audit row stays informative after
  // the row it points at has been deleted.
  "volunteer_opportunity.created",
  "volunteer_opportunity.updated",
  "volunteer_opportunity.deleted",
  // Bulk drag-reorder of the opportunity cards. One event per reorder
  // with metadata { count } — each row's new sort_order is implicit in
  // the index it landed at, same as `honorary_member.reordered`.
  "volunteer_opportunity.reordered",
  "volunteer_event.created",
  "volunteer_event.updated",
  "volunteer_event.deleted",
  // /sponsors manage affordances. Metadata carries { name } so the row
  // stays informative after the sponsor it points at has been deleted,
  // and `logoReplaced` on an update so an audit reader can tell a copy
  // edit from a new mark going up.
  "sponsor.created",
  "sponsor.updated",
  "sponsor.deleted",
  // Bulk drag-reorder of the sponsor grid. One event per reorder with
  // metadata { count }, same shape as `volunteer_opportunity.reordered`.
  "sponsor.reordered",
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
 * Three levels, because the cave owns fleets rather than one-offs:
 *
 *   - `gear_types` — the browse category ("Quickdraw", "Harness"). Owns
 *     the code prefix and the default inspection cadence.
 *   - `gear_models` — the product ("BD HotForge 12cm"). Owns everything
 *     true of every unit of it: manufacturer, MSRP, service life,
 *     product photo. **Also owns `tracking`** (below).
 *   - `gear_items` — one physical unit, with its own code, serial and
 *     date of manufacture. Only exists for `tracking = "coded"` models.
 *
 * Retyping "Black Diamond" onto forty quickdraw rows was the old shape;
 * the model layer stores it once, which is also what makes "7 of 12
 * available" and recall-matching answerable at all.
 *
 * **Coded vs counted.** Not every model is labelled. Harnesses, ropes
 * and tents each carry a code; quickdraws and pre-cut slings are handed
 * out by the handful. A `counted` model has **no item rows at all** —
 * `gear_stock_levels` holds a quantity per condition bucket, and loans
 * against it carry a quantity instead of an item. Giving each draw a row
 * anyway would be fake precision: when five of six come back, nothing
 * knows which one is gone, so the desk would be picking rows at random.
 *
 * `tracking` lives on the **model**, not the type, so the cave can code
 * a special alpine draw set while everyday draws stay counted.
 */

/**
 * Terminal disposition. One-way in practice: `reactivateItem` exists to
 * undo a mis-click, not as a normal transition.
 *
 * Split out from the old `lifecycle`/`condition` pair, which mixed "is
 * it still ours" with "is it broken" with "where is it". Those are three
 * independent questions and a piece can be any combination of them —
 * notably `missing` + `needs_repair`, which the old single column could
 * not express.
 */
export const gearStatus = ["active", "retired", "lost", "disposed"] as const;
export type GearStatus = (typeof gearStatus)[number];

/**
 * Physical serviceability — "can this be loaned?" — and nothing else.
 * Whereabouts moved to its own column, which frees `condition` to mean
 * the one thing the cave already uses the word for.
 *
 * `needs_repair` is loanable with an officer override (worn, still
 * works). `unsafe` is a hard block with no override path: a cored
 * sheath or a cracked helmet never goes out, whoever is asking.
 *
 * Only an inspection may raise this value. Anyone can lower it at
 * check-in by reporting damage.
 */
export const gearCondition = ["serviceable", "needs_repair", "unsafe"] as const;
export type GearCondition = (typeof gearCondition)[number];

/**
 * Where the item physically is when it is **not** out on loan. Loan
 * state is derived from `gear_loans` and deliberately not mirrored here
 * — one source of truth for checkout.
 *
 * `missing` is the odd one out: it is inferred from *absence* at the
 * close of an inventory sweep rather than recorded as it happens, which
 * is why `whereaboutsAsOf` exists. An item out on loan is legitimately
 * absent from the cave and can never be marked missing.
 */
export const gearWhereabouts = [
  "cave",
  "repair",
  "officer",
  "missing",
] as const;
export type GearWhereabouts = (typeof gearWhereabouts)[number];

/** See the `gear_models` block comment. */
export const gearTracking = ["coded", "counted"] as const;
export type GearTracking = (typeof gearTracking)[number];

/**
 * How the club came to own it. Exists so a null/zero
 * `acquisitionCostCents` stops meaning both "it was free" and "we lost
 * the receipt" — replacement-value reporting needs to tell those apart.
 */
export const gearAcquisitionKind = [
  "purchased",
  "donated",
  "found",
  "warranty_replacement",
] as const;
export type GearAcquisitionKind = (typeof gearAcquisitionKind)[number];

export const gearTypes = sqliteTable(
  "gear_types",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    // Display-only convention hint (e.g. "CH" for Climbing Harness).
    // NOT enforced against gear_items.code — officers may give an item
    // any code regardless of its type's prefix. The create-item UI uses
    // this only to seed a "Suggested: CH4" auto-fill.
    prefix: text("prefix"),
    description: text("description"),
    // Default inspection cadence for items of this type, in days. A
    // model may override it. NULL means "no cadence" — inspections are
    // still recordable, nothing is ever reported as due.
    inspectionIntervalDays: integer("inspection_interval_days"),
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

export const gearModels = sqliteTable(
  "gear_models",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    // RESTRICT: a type can't be removed while any model references it.
    typeId: text("type_id")
      .notNull()
      .references(() => gearTypes.id, { onDelete: "restrict" }),
    // Manufacturer + name together identify the product. Both freeform:
    // "unbranded" donations are real and a required brand would invite
    // junk values. A one-off gets a thin model with a single item.
    manufacturer: text("manufacturer"),
    name: text("name").notNull(),
    tracking: text("tracking", { enum: gearTracking })
      .notNull()
      .default("coded"),
    description: text("description"),
    // Manufacturer's listed retail price, in cents. Lives here rather
    // than per-item so replacement value stays right for donated and
    // pro-deal units, and so a loss charge is computable later.
    msrpCents: integer("msrp_cents"),
    // Manufacturer's stated service life. **Runs from date of
    // manufacture, not acquisition** — soft goods age on the shelf, so
    // a harness bought new in 2024 but made in 2019 is already five
    // years in. NULL for hardware with no stated life.
    serviceLifeYears: integer("service_life_years"),
    // Overrides the type's cadence when set.
    inspectionIntervalDays: integer("inspection_interval_days"),
    // R2 key for the product shot, shared by every item of this model.
    // An item's own `thumbnailKey` wins when set (damage, distinguishing
    // marks); otherwise the card falls back to this, then to the
    // placeholder SVG.
    imageKey: text("image_key"),
    // Manufacturer's product or manual page. Scheme-restricted on write
    // and re-checked at render — see the public-pages rule.
    productUrl: text("product_url"),
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
    index("gear_models_type_idx").on(t.typeId),
    index("gear_models_tracking_idx").on(t.tracking),
    // `manufacturer` is nullable and SQLite treats NULLs as distinct, so
    // a plain three-column index lets "Rope" be created twice under one
    // type with the brand left blank — two identical models, items split
    // across them, the same product listed twice in browse.
    // `coalesce(..., '')` makes blank collide with blank, while "Petzl
    // Rope" and an unbranded "Rope" stay distinct. `createGearModelAction`
    // reads the violation back as `name_in_use`.
    uniqueIndex("gear_models_type_manufacturer_name_unique").on(
      t.typeId,
      sql`coalesce(${t.manufacturer}, '')`,
      t.name,
    ),
  ],
);

export const gearItems = sqliteTable(
  "gear_items",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    // RESTRICT: a model can't be removed while items reference it.
    modelId: text("model_id")
      .notNull()
      .references(() => gearModels.id, { onDelete: "restrict" }),
    // The label on the physical item, e.g. "CH93". **Never recycled.**
    // Retiring keeps the code, so every historical mention of "CH93" —
    // in a note, a logbook, an audit row, someone's memory — resolves to
    // exactly one item forever. NULL only for an active item nobody has
    // labelled yet (fresh in the box); the plain UNIQUE relies on
    // SQLite's multiple-NULLs-allowed semantics for that case.
    //
    // A code can be deliberately freed by `releaseItemCode`, which NULLs
    // it on an already-retired item and records the prior value in the
    // audit row. That is the whole of the recycling story: explicit,
    // one item at a time, never a mode the system runs in.
    code: text("code"),
    serialNumber: text("serial_number"),
    // No per-item `description`. It duplicated `notesMarkdown`, which
    // already holds per-unit prose and is searchable, and in practice it
    // held the product name — which the model carries. An item's display
    // name is derived from its model (see `gearItemName`). Dropped in
    // migration 0069.
    // Overrides the model's `imageKey` when set.
    thumbnailKey: text("thumbnail_key"),
    // The safety clock for soft goods. See `serviceLifeYears`.
    manufacturedAt: timestamp("manufactured_at"),
    acquiredAt: timestamp("acquired_at"),
    acquisitionCostCents: integer("acquisition_cost_cents"),
    acquisitionKind: text("acquisition_kind", { enum: gearAcquisitionKind }),
    notesMarkdown: text("notes_markdown"),
    status: text("status", { enum: gearStatus }).notNull().default("active"),
    condition: text("condition", { enum: gearCondition })
      .notNull()
      .default("serviceable"),
    whereabouts: text("whereabouts", { enum: gearWhereabouts })
      .notNull()
      .default("cave"),
    // When the whereabouts became true. Required by the action layer for
    // `missing` (it is inferred from a dated sweep, so an undated
    // "missing" tells a manager nothing); optional otherwise.
    whereaboutsAsOf: timestamp("whereabouts_as_of"),
    // Which shop, which officer. Free text — the cave did not want a
    // vendor entity for this.
    whereaboutsNote: text("whereabouts_note"),
    // Set when `status` leaves "active", whichever terminal state it
    // lands in. Named `deactivated*` rather than `retired*` because
    // `lost` and `disposed` are terminal too and the old name lied about
    // three of the four cases.
    //
    // `reactivateItem` deliberately does NOT clear `deactivatedReason` —
    // it moves to the audit row instead. The old un-retire nulled it,
    // which destroyed the record of *why* a harness was pulled the
    // moment someone undid a mis-click.
    deactivatedAt: timestamp("deactivated_at"),
    deactivatedBy: text("deactivated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deactivatedReason: text("deactivated_reason"),
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
    uniqueIndex("gear_items_code_unique").on(t.code),
    index("gear_items_model_idx").on(t.modelId),
    index("gear_items_status_idx").on(t.status),
    index("gear_items_condition_idx").on(t.condition),
    index("gear_items_whereabouts_idx").on(t.whereabouts),
    index("gear_items_created_at_idx").on(t.createdAt),
  ],
);

/**
 * Stock for `tracking = "counted"` models: one row per condition bucket,
 * so "38 draws, 4 pulled for worn slings" is representable and the
 * unsafe ones stay out of the available count.
 *
 * Quantity here is **everything the club owns in that bucket**, including
 * units currently out on loan. Available = quantity − open loan quantity,
 * computed at read time rather than stored, so a crashed checkout can't
 * leave the two disagreeing.
 */
export const gearStockLevels = sqliteTable(
  "gear_stock_levels",
  {
    modelId: text("model_id")
      .notNull()
      .references(() => gearModels.id, { onDelete: "cascade" }),
    condition: text("condition", { enum: gearCondition }).notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.modelId, t.condition] })],
);

/**
 * Tag visibility scope. `public` tags are visible to anyone with
 * `gear:read`; `internal` tags only render for `gear:manage` officers
 * — both in the multiselect surfaces and on the item card/detail read
 * paths. Used for exec-only annotations that shouldn't leak to general
 * members.
 *
 * Tags are for **multi-valued, cross-cutting** labels ("dry-treated",
 * "instruction-only"). Per-type scales like harness size belong in
 * `gear_attribute_defs`: tag names are globally unique (one "M" shared
 * by harnesses and jackets) and the tag filter is AND-only, so "M or L"
 * as tags returns nothing.
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

export const gearTagAssignments = sqliteTable(
  "gear_tag_assignments",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => gearItems.id, { onDelete: "cascade" }),
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
    primaryKey({ columns: [t.itemId, t.tagId] }),
    index("gear_tag_assignments_tag_idx").on(t.tagId),
  ],
);

/**
 * Officer-defined attributes, scoped to gear types via
 * `gear_attribute_def_types` so "Colour" can be defined once and
 * attached to a dozen types rather than redefined per type.
 *
 * `level` is what makes seeding cheap: a `model`-level attribute (rope
 * diameter) is typed once for a fleet of forty; an `item`-level one
 * (harness size) varies per unit. A counted model has no items, so only
 * model-level values can exist for it — that falls out of the shape
 * rather than needing a rule.
 */
export const gearAttributeKind = [
  "text",
  "number",
  "select",
  "boolean",
] as const;
export type GearAttributeKind = (typeof gearAttributeKind)[number];

export const gearAttributeLevel = ["model", "item"] as const;
export type GearAttributeLevel = (typeof gearAttributeLevel)[number];

export const gearAttributeDefs = sqliteTable(
  "gear_attribute_defs",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    // Stable machine key, e.g. "size". Unique across all defs so a
    // value row can never be ambiguous about which def it answers.
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: text("kind", { enum: gearAttributeKind }).notNull(),
    level: text("level", { enum: gearAttributeLevel }).notNull(),
    // JSON array of option strings for `kind = "select"`, **in display
    // order**. Order is explicit and authoritative: sorting sizes
    // alphabetically yields L, M, S, XL, which reads as a bug.
    options: text("options", { mode: "json" }).$type<string[]>(),
    // Unit for `kind = "number"` ("m", "mm", "g"). Lives on the
    // definition, never in the value — a value of "60m" is text and
    // stops being range-filterable, which defeats the point.
    unit: text("unit"),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    // Soft delete: values survive so a mis-click doesn't destroy data,
    // and the manage UI can offer them back.
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("gear_attribute_defs_key_unique").on(t.key)],
);

export const gearAttributeDefTypes = sqliteTable(
  "gear_attribute_def_types",
  {
    defId: text("def_id")
      .notNull()
      .references(() => gearAttributeDefs.id, { onDelete: "cascade" }),
    typeId: text("type_id")
      .notNull()
      .references(() => gearTypes.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.defId, t.typeId] }),
    index("gear_attribute_def_types_type_idx").on(t.typeId),
  ],
);

/**
 * Attribute values. Two tables rather than one polymorphic table so the
 * foreign keys stay real — a value row can't point at a missing item.
 *
 * Both carry `valueText` and `valueNumber`; the def's `kind` says which
 * one is authoritative. `number` writes both (the text form for display,
 * the number for range filters) so a facet query never has to cast.
 */
export const gearModelAttributeValues = sqliteTable(
  "gear_model_attribute_values",
  {
    modelId: text("model_id")
      .notNull()
      .references(() => gearModels.id, { onDelete: "cascade" }),
    defId: text("def_id")
      .notNull()
      .references(() => gearAttributeDefs.id, { onDelete: "cascade" }),
    valueText: text("value_text"),
    valueNumber: integer("value_number"),
  },
  (t) => [
    primaryKey({ columns: [t.modelId, t.defId] }),
    // Drives the facet query: distinct values for a def, cheaply.
    index("gear_model_attribute_values_def_idx").on(t.defId, t.valueText),
  ],
);

export const gearItemAttributeValues = sqliteTable(
  "gear_item_attribute_values",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => gearItems.id, { onDelete: "cascade" }),
    defId: text("def_id")
      .notNull()
      .references(() => gearAttributeDefs.id, { onDelete: "cascade" }),
    valueText: text("value_text"),
    valueNumber: integer("value_number"),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.defId] }),
    index("gear_item_attribute_values_def_idx").on(t.defId, t.valueText),
  ],
);

/**
 * Per-item inspection log. Climbing gear has real safety stakes and is
 * inspected on a cadence; this table records each inspection event so
 * the detail page can surface history and the "due for inspection"
 * report has something to compute from.
 *
 * Append-mostly. Officers correct a mistaken entry by recording a
 * superseding inspection; the historical row stays. This mirrors the
 * audit-log philosophy: the only safe way to reason about gear safety
 * later is if the trail is intact.
 *
 * **Either `itemId` or `modelId` is set, never both.** A counted model
 * has no items, so "inspected all the draws" is recorded against the
 * model. Cascade on delete either way: hard-deleting gear takes its
 * inspection history with it. Deactivation does NOT — the row stays so
 * a later "why did we retire this?" can pull the failing inspection
 * alongside the audit event.
 */
export const gearInspectionResult = ["pass", "fail", "advisory"] as const;
export type GearInspectionResult = (typeof gearInspectionResult)[number];

export const gearInspections = sqliteTable(
  "gear_inspections",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    itemId: text("item_id").references(() => gearItems.id, {
      onDelete: "cascade",
    }),
    modelId: text("model_id").references(() => gearModels.id, {
      onDelete: "cascade",
    }),
    // Inspector keeps SET NULL on user delete so the history survives an
    // officer leaving the club. `inspectorNameSnapshot` captures who it
    // was at write time so the row still reads usefully after the FK
    // nulls.
    inspectorUserId: text("inspector_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    inspectorNameSnapshot: text("inspector_name_snapshot"),
    // When the inspection physically happened. Distinct from `createdAt`
    // because officers enter paper records after the fact.
    inspectedAt: timestamp("inspected_at").notNull(),
    result: text("result", { enum: gearInspectionResult }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("gear_inspections_item_idx").on(t.itemId),
    index("gear_inspections_model_idx").on(t.modelId),
    // Supports "latest inspection per item" — the detail page's history
    // list and the due-for-inspection report both want item, date DESC.
    index("gear_inspections_item_inspected_idx").on(t.itemId, t.inspectedAt),
  ],
);

/**
 * A loan is a checkout to one member with its own due date.
 *
 * **Dual shape.** A coded loan sets `itemId` and leaves `quantity` at 1;
 * a counted loan sets `modelId` and a real `quantity` ("six draws").
 * Exactly one of the two is set — enforced by a CHECK constraint, since
 * the alternative is two near-identical tables and then two of every
 * query behind /my/gear, the overdue list and member standing.
 *
 * Counted loans support **partial return**: `quantityReturned` climbs as
 * units come back, and the loan closes when it reaches `quantity` or an
 * officer writes off the shortfall. Coded loans go straight from 0 to 1.
 *
 * Concurrency: the partial unique on `(item_id) WHERE returned_at IS
 * NULL` enforces "at most one open loan per item" at the DB layer, and
 * is what actually wins a race between two officers checking out the
 * same harness. It applies only to coded loans — counted stock is
 * guarded by an available-quantity check in the action layer, which is
 * inherently a read-then-write and can over-lend by one under a true
 * tie; the cave would rather that than a lock.
 *
 * FK choices:
 *   - item / model / member: RESTRICT — can't retire on-loan gear or
 *     delete a member account with open loans. The action layer surfaces
 *     this as a typed error; the FK is defense-in-depth.
 *   - checkedOutBy / returnedTo: SET NULL — officer accounts come and
 *     go; closed-loan history survives them.
 */
export const gearLoans = sqliteTable(
  "gear_loans",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    itemId: text("item_id").references(() => gearItems.id, {
      onDelete: "restrict",
    }),
    modelId: text("model_id").references(() => gearModels.id, {
      onDelete: "restrict",
    }),
    quantity: integer("quantity").notNull().default(1),
    quantityReturned: integer("quantity_returned").notNull().default(0),
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
    // Condition of the gear AT the moment of return. The check-in flow
    // may also update the item's own `condition`; this column is a
    // per-loan record so history isn't rewritten by later changes.
    conditionAtReturn: text("condition_at_return", { enum: gearCondition }),
    // Units never returned, written off at close. Feeds the lost-gear
    // report and, eventually, a replacement charge.
    quantityLost: integer("quantity_lost").notNull().default(0),
  },
  (t) => [
    check(
      "gear_loans_item_xor_model",
      sql`(${t.itemId} IS NOT NULL) <> (${t.modelId} IS NOT NULL)`,
    ),
    // Race-protective: only one open loan per coded item at any moment.
    uniqueIndex("gear_loans_one_active_per_item")
      .on(t.itemId)
      .where(sql`${t.returnedAt} IS NULL`),
    // Drives /my/gear (active + history per member) and the standing check.
    index("gear_loans_member_returned_idx").on(t.memberUserId, t.returnedAt),
    index("gear_loans_item_idx").on(t.itemId),
    index("gear_loans_model_idx").on(t.modelId),
    // Drives the overdue list + due-date sort on /gear/loans.
    index("gear_loans_due_idx").on(t.dueAt),
  ],
);

/**
 * An officer reserving gear ahead of a trip.
 *
 * A hold is a statement of **intent**, not a property of the object,
 * which is why it is a row rather than a fourth `condition` value: it
 * has a placer, a reason and an expiry that no enum value could carry,
 * and it must be able to coexist with `needs_repair` and with an open
 * loan (an item due back the 5th, held for a trip on the 12th).
 *
 * Same dual shape as loans — a hold on "six draws" is a counted hold,
 * and for a counted model it's the only kind there is.
 *
 * Holds **hard-block member checkout** and are overridable by
 * `gear:manage` with a confirm; a soft warning gets trampled and then
 * nobody trusts holds. They auto-release at `endsAt` (evaluated at read
 * time, so no cron), and the manage UI lists expired-but-unreleased ones
 * so stale reservations surface rather than rot.
 *
 * `reason` is free text until trips are a real entity; a `tripId` FK
 * lands cleanly beside it when they are.
 */
export const gearHolds = sqliteTable(
  "gear_holds",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    itemId: text("item_id").references(() => gearItems.id, {
      onDelete: "cascade",
    }),
    modelId: text("model_id").references(() => gearModels.id, {
      onDelete: "cascade",
    }),
    quantity: integer("quantity").notNull().default(1),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    releasedAt: timestamp("released_at"),
    releasedByUserId: text("released_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    heldByUserId: text("held_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    check(
      "gear_holds_item_xor_model",
      sql`(${t.itemId} IS NOT NULL) <> (${t.modelId} IS NOT NULL)`,
    ),
    index("gear_holds_item_idx").on(t.itemId),
    index("gear_holds_model_idx").on(t.modelId),
    // Drives "is this held right now" and the expired-holds list.
    index("gear_holds_window_idx").on(t.endsAt, t.releasedAt),
  ],
);

/**
 * A cave-wide inventory count.
 *
 * Several people scan into the same open sweep at once, so `seenBy`
 * lives on each entry rather than on the sweep. **Presence is recorded;
 * absence is inferred at close** — which is the whole reason sweeps are
 * an entity instead of a per-item checkbox, and where `missing` and its
 * `whereaboutsAsOf` date come from.
 *
 * On close, every active coded item with no entry, no open loan, and not
 * already at `repair` or with an `officer` flips to `missing`. Counted
 * models compare the counted quantity plus quantity-on-loan against
 * stock, and a shortfall is surfaced to the closing officer rather than
 * written off automatically — a miscount is likelier than four lost
 * draws, and the write-off should be a decision.
 */
export const gearInventorySweeps = sqliteTable(
  "gear_inventory_sweeps",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    startedByUserId: text("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at"),
    closedByUserId: text("closed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (t) => [index("gear_inventory_sweeps_closed_idx").on(t.closedAt)],
);

export const gearInventorySweepEntries = sqliteTable(
  "gear_inventory_sweep_entries",
  {
    sweepId: text("sweep_id")
      .notNull()
      .references(() => gearInventorySweeps.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => gearItems.id, {
      onDelete: "cascade",
    }),
    modelId: text("model_id").references(() => gearModels.id, {
      onDelete: "cascade",
    }),
    // For a counted model the entry IS the count; for a coded item it is
    // 1 and only presence matters.
    quantityCounted: integer("quantity_counted").notNull().default(1),
    seenAt: timestamp("seen_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    seenByUserId: text("seen_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check(
      "gear_sweep_entries_item_xor_model",
      sql`(${t.itemId} IS NOT NULL) <> (${t.modelId} IS NOT NULL)`,
    ),
    index("gear_inventory_sweep_entries_sweep_idx").on(t.sweepId),
    uniqueIndex("gear_inventory_sweep_entries_sweep_item_unique").on(
      t.sweepId,
      t.itemId,
    ),
    uniqueIndex("gear_inventory_sweep_entries_sweep_model_unique").on(
      t.sweepId,
      t.modelId,
    ),
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
export type HeroSlide = typeof heroSlides.$inferSelect;
export type LandingFaqItem = typeof landingFaqItems.$inferSelect;
export type LandingActivity = typeof landingActivities.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type GearType = typeof gearTypes.$inferSelect;
export type GearModel = typeof gearModels.$inferSelect;
export type GearItem = typeof gearItems.$inferSelect;
export type GearStockLevel = typeof gearStockLevels.$inferSelect;
export type GearTag = typeof gearTags.$inferSelect;
export type GearTagAssignment = typeof gearTagAssignments.$inferSelect;
export type GearAttributeDef = typeof gearAttributeDefs.$inferSelect;
export type GearModelAttributeValue =
  typeof gearModelAttributeValues.$inferSelect;
export type GearItemAttributeValue =
  typeof gearItemAttributeValues.$inferSelect;
export type GearInspection = typeof gearInspections.$inferSelect;
export type GearLoan = typeof gearLoans.$inferSelect;
export type GearHold = typeof gearHolds.$inferSelect;
export type GearInventorySweep = typeof gearInventorySweeps.$inferSelect;
export type GearInventorySweepEntry =
  typeof gearInventorySweepEntries.$inferSelect;

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
  "volunteer",
  "sponsors",
  "sponsors_pitch",
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
 * Album — UCMC's photo archive. Photos are cropped to a fixed
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
 * `altText` for accessibility (every album `<img>` MUST have alt
 * text; this is the SQL guard for it). Width/height columns are
 * stored even though the aspect is fixed so a future masonry layout
 * doesn't need a column-add migration.
 */
export const albumPhotos = sqliteTable(
  "album_photos",
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
    // Drives tag-filtered queries from the grid's tag dropdown.
    // No `taken_at` index — the list query orders by
    // `COALESCE(taken_at, created_at) DESC` which the planner can't
    // serve from an index on `taken_at` alone (it would need an
    // expression index). Club-scale photo counts (<1k) sort
    // unindexed in microseconds either way.
    index("album_photos_tag_idx").on(t.tag),
  ],
);

export type AlbumPhoto = typeof albumPhotos.$inferSelect;

/**
 * The standing volunteer programs UCMC runs — trail work, crag
 * cleanups, adopt-a-highway, gear drives. These are *kinds* of
 * service, not dated instances; a dated instance is a
 * {@link volunteerEvents} row.
 *
 * Shaped like `landing_activities` (curated icon + title + blurb,
 * drag-reorderable) but deliberately a separate table rather than a
 * reuse with a discriminator column: the home page's activity cards
 * are climbing disciplines and these are service programs, and one
 * list would put two unrelated editors in the same reorder surface.
 * The `icon` string is validated against the shared curated whitelist
 * in `src/components/curated-icon/` at write time.
 */
export const volunteerOpportunities = sqliteTable(
  "volunteer_opportunities",
  {
    id: text("id").primaryKey(),
    icon: text("icon").notNull(),
    title: text("title").notNull(),
    blurb: text("blurb").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("volunteer_opportunities_sort_idx").on(t.sortOrder)],
);

export type VolunteerOpportunity = typeof volunteerOpportunities.$inferSelect;

/**
 * One dated volunteer outing, past or future.
 *
 * **There is deliberately no status column.** Whether a row belongs in
 * /volunteer's "Coming up" band or its "Our record" archive is derived
 * from `starts_at`, so nothing has to be flipped by hand or by a cron
 * and the two bands can never disagree about the same row. The
 * predicate compares against the *start of today* in `CLUB_TIME_ZONE`
 * (see `volunteer-repo.server.ts`), not `now` — a trail day that began
 * at 09:00 shouldn't drop out of "Coming up" at noon while people are
 * still driving to it. That's the same end-of-day convention gear
 * due-dates use, and it keeps the comparison an indexed range scan on
 * `starts_at`.
 *
 * `volunteers_count` / `service_hours` are nullable because an officer
 * logs the event before it happens and fills the numbers in afterwards,
 * if ever. The totals strip sums only recorded values and reports its
 * own coverage, so a partially-filled archive reads as incomplete
 * rather than as a small club.
 *
 * `album_tag` points a past event at photos that already live in
 * `album_photos` (matched on that table's freeform `tag`) rather than
 * introducing a second upload-and-crop path. It is a loose string
 * match, not an FK — the Album's tags are freeform and an event may
 * name a tag before any photo carries it.
 *
 * `public_id` is minted now so a future `/volunteer/$publicId` detail
 * route and a future `volunteer_signups` table keyed on `id` cost
 * nothing later; nothing links to it yet.
 */
export const volunteerEvents = sqliteTable(
  "volunteer_events",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    title: text("title").notNull(),
    partnerOrg: text("partner_org"),
    location: text("location"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    description: text("description"),
    // When the partner org runs its own registration form, the event's
    // join affordance links there instead of opening a mailto.
    signupUrl: text("signup_url"),
    volunteersCount: integer("volunteers_count"),
    serviceHours: integer("service_hours"),
    albumTag: text("album_tag"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // Snapshot of who logged / last touched the row, SET NULL on
    // delete so the row survives an officer's account removal.
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // Serves both reads: ascending for "Coming up", descending for the
    // archive, each a range scan against the day-boundary bound.
    index("volunteer_events_starts_at_idx").on(t.startsAt),
  ],
);

export type VolunteerEvent = typeof volunteerEvents.$inferSelect;

/**
 * One organization that sponsors UCMC (issue #185).
 *
 * A **flat, curated list** — no `since` / `until` columns and no
 * active-vs-past split. Sponsorship here is a standing relationship
 * with a handful of local businesses rather than a per-season contract,
 * so a date-derived "past supporters" band would mostly be an empty
 * heading. `sort_order` is the officer's curation order (drag-reorder
 * on the page), and `public_id` is minted now so a future
 * `/sponsors/$publicId` detail route or a past-sponsor band costs
 * nothing later; nothing links to it yet.
 *
 * **`member_perk` is the one non-public column.** A sponsor's discount
 * code or how-to-claim instructions are a membership benefit, so the
 * read action strips the column outright for anyone without
 * `public_sponsors:perks` — hiding it client-side would still ship it
 * in the SSR payload of a page anonymous visitors can load. See
 * `sponsor-actions.server.ts`.
 *
 * `logo_key` is nullable: a sponsor can be listed before anyone has
 * chased down a usable copy of their mark, and the card falls back to
 * the name set in type. `logo_width_px` / `logo_height_px` are the
 * *stored* pixel dimensions of the contained WebP — the card renders it
 * `object-contain` in a fixed box, so these exist to reserve the right
 * intrinsic ratio and avoid a layout shift, not to size the box.
 *
 * There is deliberately no `logo_alt` column, unlike `album_photos`.
 * The card always renders `name` as visible text beside the mark, so
 * the image is decorative and takes `alt=""` — an alt of the sponsor's
 * name would make a screen reader announce it twice.
 */
export const sponsors = sqliteTable(
  "sponsors",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    // http(s) only. Validated on write by `sponsor-schemas.ts` and
    // re-checked at render by `sponsorWebsiteHref()`, because a schema
    // only guards writes made after it shipped.
    websiteUrl: text("website_url"),
    /** What the sponsor does for the club — public. */
    blurb: text("blurb").notNull(),
    /** Member-only: discount, code, how to claim. Stripped server-side. */
    memberPerk: text("member_perk"),
    logoKey: text("logo_key"),
    logoWidthPx: integer("logo_width_px"),
    logoHeightPx: integer("logo_height_px"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // Snapshot of who added / last touched the row, SET NULL on delete
    // so the row survives an officer's account removal.
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("sponsors_sort_idx").on(t.sortOrder)],
);

export type Sponsor = typeof sponsors.$inferSelect;
