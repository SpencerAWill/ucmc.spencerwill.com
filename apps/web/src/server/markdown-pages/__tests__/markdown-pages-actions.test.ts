import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

// ── mocks ──────────────────────────────────────────────────────────────

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkUploadRateLimit: async () => true,
}));

const { getMarkdownPageAction, updateMarkdownPageAction } =
  await import("#/server/markdown-pages/markdown-pages-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { invalidateAnonymousPermissionsCache } =
  await import("#/server/auth/principal.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: Temporal.Now.instant(),
  });
  return id;
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInAsAdmin(email = "admin@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

/**
 * Create a bespoke role granting exactly one permission (by name), and
 * assign it to `userId`. Used to test the cross-slug isolation — a
 * `public_policies:manage` holder must not be able to edit
 * `history.narrative`.
 */
async function grantOnePermissionViaCustomRole(
  userId: string,
  permissionName: string,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(eq(schema.permissions.name, permissionName))
    .limit(1);
  const perm = rows.at(0);
  if (!perm) {
    throw new Error(`Permission not found: ${permissionName}`);
  }
  const roleId = `role_${crypto.randomUUID()}`;
  await db.insert(schema.roles).values({
    id: roleId,
    name: `test_${permissionName.replace(/[^a-z0-9_]/g, "_")}_${roleId.slice(-6)}`,
    displayName: `Test ${permissionName}`,
    description: "test-only",
  });
  await db
    .insert(schema.rolePermissions)
    .values({ roleId, permissionId: perm.id });
  await db.insert(schema.userRoles).values({ userId, roleId });
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.markdownPages);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
  // Migrations seed perms before the row delete above; the KV cache may
  // be stale across tests. Drop it so anonymous reads re-query D1.
  await invalidateAnonymousPermissionsCache();
});

// ── getMarkdownPageAction ──────────────────────────────────────────────

describe("getMarkdownPageAction", () => {
  it("lets anonymous callers read a slug granted to role_anonymous", async () => {
    const { slug, markdown } = await getMarkdownPageAction({
      slug: "policies",
    });
    expect(slug).toBe("policies");
    expect(typeof markdown).toBe("string");
  });

  it("rejects anonymous callers for a slug NOT granted to role_anonymous", async () => {
    await expect(
      getMarkdownPageAction({ slug: "history.narrative" }),
    ).rejects.toThrow(/history:view/);
  });

  it("rejects signed-in users without the slug's view permission", async () => {
    // A signed-in user with no role assignment has zero permissions.
    const userId = await seedUser("nobody@example.com");
    await signInAs(userId);
    await expect(
      getMarkdownPageAction({ slug: "history.narrative" }),
    ).rejects.toThrow(/history:view/);
  });

  it("lets a history:view holder read history.narrative", async () => {
    // system_admin auto-grants every permission (principal bypass).
    await signInAsAdmin();
    const { markdown } = await getMarkdownPageAction({
      slug: "history.narrative",
    });
    expect(typeof markdown).toBe("string");
  });

  it("returns the empty-string default when the slug has no row", async () => {
    // beforeEach already wiped markdown_pages — every slug is a miss.
    const { markdown } = await getMarkdownPageAction({ slug: "policies" });
    expect(markdown).toBe("");
  });
});

// ── updateMarkdownPageAction ───────────────────────────────────────────

describe("updateMarkdownPageAction", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      updateMarkdownPageAction({
        slug: "policies",
        markdown: "# hi",
      }),
    ).rejects.toThrow(/not signed in/i);
  });

  it("rejects signed-in callers without the slug's manage permission", async () => {
    const userId = await seedUser("policies-editor@example.com");
    await grantOnePermissionViaCustomRole(userId, "public_policies:manage");
    await signInAs(userId);

    // Holder of `public_policies:manage` should NOT be able to edit a
    // different slug (history.narrative requires `history:manage`).
    await expect(
      updateMarkdownPageAction({
        slug: "history.narrative",
        markdown: "# history",
      }),
    ).rejects.toThrow(/history:manage/);
  });

  it("writes the body and emits a markdown_page.updated audit event", async () => {
    const actorId = await signInAsAdmin();

    await updateMarkdownPageAction({
      slug: "policies",
      markdown: "# New policies\n\nUpdated body.",
    });

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "markdown_page.updated"),
          eq(schema.auditLog.targetId, "policies"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    expect(auditRows[0].targetType).toBe("markdown_page");
    const meta = JSON.parse(auditRows[0].metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.slug).toBe("policies");
    expect(meta.markdownLength).toBe("# New policies\n\nUpdated body.".length);
  });

  it("round-trips: write then read returns the new body", async () => {
    await signInAsAdmin();
    const body = "# Resources\n\nUpdated content.";
    await updateMarkdownPageAction({ slug: "resources", markdown: body });
    const { markdown } = await getMarkdownPageAction({ slug: "resources" });
    expect(markdown).toBe(body);
  });
});
