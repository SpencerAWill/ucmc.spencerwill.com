import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
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

const { requireSession } = await import("#/server/auth/session.server");

async function seedSession(
  opts: {
    expiresAt?: Date;
  } = {},
): Promise<{ sid: string; userId: string }> {
  const userId = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id: userId,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  const sid = crypto.randomUUID();
  const now = new Date();
  await getDb()
    .insert(schema.sessions)
    .values({
      id: sid,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: opts.expiresAt ?? new Date(now.getTime() + 60_000),
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

describe("requireSession", () => {
  it("returns null when no session cookie is set", async () => {
    expect(await requireSession()).toBeNull();
  });

  it("returns null when the cookie points at no session row", async () => {
    cookieValue = "00000000-0000-0000-0000-000000000000";
    expect(await requireSession()).toBeNull();
    expect(cookieCleared).toBe(true);
  });

  it("returns null and clears the cookie when the session is expired", async () => {
    const { sid } = await seedSession({
      expiresAt: new Date(Date.now() - 1000),
    });
    cookieValue = sid;
    expect(await requireSession()).toBeNull();
    expect(cookieCleared).toBe(true);
  });

  it("returns { userId } for a valid session", async () => {
    const { sid, userId } = await seedSession();
    cookieValue = sid;
    expect(await requireSession()).toEqual({ userId });
  });

  it("does not call loadPrincipal", async () => {
    const { sid } = await seedSession();
    cookieValue = sid;
    await requireSession();
    expect(loadPrincipalSpy).not.toHaveBeenCalled();
  });
});
