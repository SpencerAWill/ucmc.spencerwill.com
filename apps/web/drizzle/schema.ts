// Define Drizzle table schemas here.
// After edits, run: pnpm --filter ucmc-web db:generate
// See: https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import {
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
    email: text("email").notNull(),
    status: text("status", { enum: userStatus }).notNull().default("pending"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by"),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  preferredName: text("preferred_name").notNull(),
  mNumber: text("m_number").notNull(),
  phone: text("phone").notNull(),
  ucAffiliation: text("uc_affiliation", { enum: ucAffiliation }).notNull(),
  avatarKey: text("avatar_key"),
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

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type EmergencyContact = typeof emergencyContacts.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type MagicLink = typeof magicLinks.$inferSelect;
