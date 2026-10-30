/**
 * `assertCanView` and the public-page reads that call it (#381). The
 * route guard used to be the only check, so a direct call to a server
 * fn still served a page whose view permission an operator had taken
 * off `role_anonymous`.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const { assertCanView } = await import("#/server/auth/view-permission.server");
const { openSession } = await import("#/server/auth/session.server");
const { invalidateAnonymousPermissionsCache } =
  await import("#/server/auth/principal.server");
const { getAlbumPhotosAction, getAlbumPhotoByPublicIdAction } =
  await import("#/features/album/server/album-actions.server");
const { getGazetteIssuesAction, getGazetteIssueByPublicIdAction } =
  await import("#/features/gazette/server/gazette-actions.server");
const { getHistoryContentAction } =
  await import("#/features/history/server/history-actions.server");
const { getSponsorsContentAction } =
  await import("#/features/sponsors/server/sponsor-actions.server");
const { getVolunteerContentAction } =
  await import("#/features/volunteer/server/volunteer-actions.server");
const { listCalendarOccurrencesAction, getCalendarOccurrenceAction } =
  await import("#/features/calendar/server/event-actions.server");

// ── helpers ────────────────────────────────────────────────────────────

const ANONYMOUS_ROLE_ID = "role_anonymous";
let anonymousGrants: (typeof schema.rolePermissions.$inferSelect)[] = [];

async function permissionId(name: string): Promise<string> {
  const row = await getDb()
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(eq(schema.permissions.name, name))
    .get();
  if (!row) {
    throw new Error(`Permission not found: ${name}`);
  }
  return row.id;
}

/** Take one permission off `role_anonymous`, as an operator would at /access. */
async function revokeFromAnonymous(name: string): Promise<void> {
  await getDb()
    .delete(schema.rolePermissions)
    .where(
      and(
        eq(schema.rolePermissions.roleId, ANONYMOUS_ROLE_ID),
        eq(schema.rolePermissions.permissionId, await permissionId(name)),
      ),
    );
  await invalidateAnonymousPermissionsCache();
}

async function signInWithRoles(roleIds: string[]): Promise<void> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await attachPrimaryEmail(id, `${id}@example.com`);
  for (const roleId of roleIds) {
    await db.insert(schema.userRoles).values({ userId: id, roleId });
  }
  await openSession(id);
}

beforeAll(async () => {
  anonymousGrants = await getDb()
    .select()
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, ANONYMOUS_ROLE_ID));
});

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
  // Put back whatever a previous test revoked.
  await db
    .delete(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, ANONYMOUS_ROLE_ID));
  if (anonymousGrants.length > 0) {
    await db.insert(schema.rolePermissions).values(anonymousGrants);
  }
  await invalidateAnonymousPermissionsCache();
});

// ── assertCanView ──────────────────────────────────────────────────────

describe("assertCanView", () => {
  it("lets a signed-out caller through on a permission the anonymous role holds", async () => {
    await expect(assertCanView("public_album:view")).resolves.toBeUndefined();
  });

  it("refuses a signed-out caller once the anonymous grant is revoked", async () => {
    await revokeFromAnonymous("public_album:view");
    await expect(assertCanView("public_album:view")).rejects.toThrow(
      "Forbidden: missing public_album:view",
    );
  });

  it("lets a signed-in holder through when the anonymous role lacks it", async () => {
    // `role_member` holds `public_album:view` too, so revoking the
    // anonymous grant makes the album members-only, not invisible.
    await revokeFromAnonymous("public_album:view");
    await signInWithRoles(["role_member"]);
    await expect(assertCanView("public_album:view")).resolves.toBeUndefined();
  });

  it("refuses a signed-in caller holding neither grant", async () => {
    await revokeFromAnonymous("public_album:view");
    await signInWithRoles([]);
    await expect(assertCanView("public_album:view")).rejects.toThrow(
      "Forbidden: missing public_album:view",
    );
  });
});

// ── the reads that call it ─────────────────────────────────────────────

const WINDOW = {
  from: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  until: Temporal.Instant.from("2026-10-01T00:00:00Z"),
};

const READS: [string, string, () => Promise<unknown>][] = [
  ["getAlbumPhotosAction", "public_album:view", () => getAlbumPhotosAction()],
  [
    "getAlbumPhotoByPublicIdAction",
    "public_album:view",
    () => getAlbumPhotoByPublicIdAction({ publicId: "abc123" }),
  ],
  [
    "getGazetteIssuesAction",
    "public_gazette:view",
    () => getGazetteIssuesAction(),
  ],
  [
    "getGazetteIssueByPublicIdAction",
    "public_gazette:view",
    () => getGazetteIssueByPublicIdAction({ publicId: "abc123" }),
  ],
  ["getHistoryContentAction", "history:view", () => getHistoryContentAction()],
  [
    "getSponsorsContentAction",
    "public_sponsors:view",
    () => getSponsorsContentAction(),
  ],
  [
    "getVolunteerContentAction",
    "public_volunteer:view",
    () => getVolunteerContentAction(),
  ],
  [
    "listCalendarOccurrencesAction",
    "public_calendar:view",
    () => listCalendarOccurrencesAction(WINDOW),
  ],
  [
    "getCalendarOccurrenceAction",
    "public_calendar:view",
    () => getCalendarOccurrenceAction({ publicId: "abc123" }),
  ],
];

describe.each(READS)("%s", (_name, permission, read) => {
  it(`refuses a signed-out caller without ${permission}`, async () => {
    await revokeFromAnonymous(permission);
    await expect(read()).rejects.toThrow(`Forbidden: missing ${permission}`);
  });

  it(`serves a signed-in holder of ${permission}`, async () => {
    // Pins that the check reads the principal too, not only the
    // anonymous role. system_admin holds every permission.
    await revokeFromAnonymous(permission);
    await signInWithRoles(["role_system_admin"]);
    await expect(read()).resolves.not.toThrow();
  });
});
