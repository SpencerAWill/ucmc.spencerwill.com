import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import type { UserStatus } from "#/../drizzle/schema";
import type * as PrincipalModule from "#/server/auth/principal.server";

let cookieValue: string | undefined;
let cookieCleared = false;

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => cookieValue,
  setCookie: () => {},
  deleteCookie: () => {
    cookieCleared = true;
  },
  getRequestHeader: () => undefined,
}));

const loadPrincipalSpy = vi.fn(async () => null);
vi.mock("#/server/auth/principal.server", async () => {
  const actual = await vi.importActual<typeof PrincipalModule>(
    "#/server/auth/principal.server",
  );
  return {
    ...actual,
    loadPrincipal: loadPrincipalSpy,
  };
});

const { loadCurrentSession } = await import("#/server/auth/session.server");

async function seedSession(
  opts: {
    expiresAt?: Temporal.Instant;
    status?: UserStatus;
  } = {},
): Promise<{ sid: string; userId: string }> {
  const userId = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id: userId,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: opts.status ?? "approved",
    });
  const sid = crypto.randomUUID();
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.sessions)
    .values({
      id: sid,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: opts.expiresAt ?? now.add({ milliseconds: 60_000 }),
    });
  return { sid, userId };
}

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.sessions);
  await db.delete(schema.users);
  cookieValue = undefined;
  cookieCleared = false;
  loadPrincipalSpy.mockClear();
});

describe("loadCurrentSession", () => {
  it("returns null when no session cookie is set", async () => {
    expect(await loadCurrentSession()).toBeNull();
  });

  it("returns null when the cookie points at no session row", async () => {
    cookieValue = "00000000-0000-0000-0000-000000000000";
    expect(await loadCurrentSession()).toBeNull();
    expect(cookieCleared).toBe(true);
  });

  it("returns null and clears the cookie when the session is expired", async () => {
    const { sid } = await seedSession({
      expiresAt: Temporal.Now.instant().subtract({ milliseconds: 1000 }),
    });
    cookieValue = sid;
    expect(await loadCurrentSession()).toBeNull();
    expect(cookieCleared).toBe(true);
  });

  it("returns { userId } for a valid session", async () => {
    const { sid, userId } = await seedSession();
    cookieValue = sid;
    expect(await loadCurrentSession()).toEqual({ userId });
  });

  it("does not call loadPrincipal", async () => {
    const { sid } = await seedSession();
    cookieValue = sid;
    await loadCurrentSession();
    expect(loadPrincipalSpy).not.toHaveBeenCalled();
  });

  // Locks in the documented behavior that deactivation is intentionally
  // NOT checked here — callers that care must reach for loadCurrentPrincipal.
  it("returns { userId } even when the user is deactivated", async () => {
    const { sid, userId } = await seedSession({ status: "deactivated" });
    cookieValue = sid;
    expect(await loadCurrentSession()).toEqual({ userId });
  });
});
