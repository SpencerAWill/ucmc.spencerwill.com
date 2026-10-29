import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "#/server/auth/bearer-token.server";
import {
  SESSION_SLIDING_REFRESH_MS,
  SESSION_TTL_MS,
} from "#/server/auth/session-config";
import { getDb, schema } from "#/server/db";
import type { UserStatus } from "#/../drizzle/schema";
import type * as PrincipalModule from "#/server/auth/principal.server";

let cookieValue: string | undefined;
let cookieCleared = false;
const setCookieSpy = vi.fn((_name: string, value: string) => {
  cookieValue = value;
});

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => cookieValue,
  setCookie: setCookieSpy,
  deleteCookie: () => {
    cookieCleared = true;
  },
  getRequestHeader: () => undefined,
}));

const loadPrincipalSpy = vi.fn(
  async (): Promise<PrincipalModule.Principal | null> => null,
);
vi.mock("#/server/auth/principal.server", async () => {
  const actual = await vi.importActual<typeof PrincipalModule>(
    "#/server/auth/principal.server",
  );
  return {
    ...actual,
    loadPrincipal: loadPrincipalSpy,
  };
});

const {
  closeSession,
  loadCurrentPrincipal,
  loadCurrentSession,
  openSession,
  rotateSession,
} = await import("#/server/auth/session.server");

async function seedSession(
  opts: {
    expiresAt?: Temporal.Instant;
    lastSeenAt?: Temporal.Instant;
    status?: UserStatus;
  } = {},
): Promise<{ sid: string; userId: string }> {
  const userId = await seedUser(opts.status);
  // `sid` is the cookie value; the row is keyed by its hash.
  const sid = crypto.randomUUID();
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.sessions)
    .values({
      id: await hashToken(sid),
      userId,
      createdAt: now,
      lastSeenAt: opts.lastSeenAt ?? now,
      expiresAt: opts.expiresAt ?? now.add({ milliseconds: 60_000 }),
    });
  return { sid, userId };
}

async function seedUser(status: UserStatus = "approved"): Promise<string> {
  const userId = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id: userId,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status,
    });
  return userId;
}

async function sessionRowIds(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
  return rows.map((r) => r.id);
}

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.sessions);
  await db.delete(schema.users);
  cookieValue = undefined;
  cookieCleared = false;
  setCookieSpy.mockClear();
  loadPrincipalSpy.mockClear();
});

describe("loadCurrentPrincipal sliding refresh", () => {
  // Only `status` is read past the null check, so a partial principal is
  // enough to reach the sliding branch.
  const approvedPrincipal = {
    status: "approved",
  } as PrincipalModule.Principal;

  it("re-sends the cookie with a full maxAge when the session slides (#374)", async () => {
    const now = Temporal.Now.instant();
    const { sid } = await seedSession({
      lastSeenAt: now.subtract({
        milliseconds: SESSION_SLIDING_REFRESH_MS + 1000,
      }),
    });
    cookieValue = sid;
    loadPrincipalSpy.mockResolvedValueOnce(approvedPrincipal);

    expect(await loadCurrentPrincipal()).toBe(approvedPrincipal);

    const row = await getDb().query.sessions.findFirst({
      where: eq(schema.sessions.id, await hashToken(sid)),
    });
    expect(
      row!.expiresAt.epochMilliseconds - now.epochMilliseconds,
    ).toBeGreaterThanOrEqual(SESSION_TTL_MS);
    // The cookie must carry the token itself; re-sending the row id (its
    // hash) would miss on the next request and sign the member out.
    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    expect(setCookieSpy).toHaveBeenCalledWith(
      expect.any(String),
      sid,
      expect.objectContaining({ maxAge: Math.floor(SESSION_TTL_MS / 1000) }),
    );
  });

  it("leaves the cookie alone inside the refresh window", async () => {
    const { sid } = await seedSession();
    cookieValue = sid;
    loadPrincipalSpy.mockResolvedValueOnce(approvedPrincipal);

    expect(await loadCurrentPrincipal()).toBe(approvedPrincipal);
    expect(setCookieSpy).not.toHaveBeenCalled();
  });
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

// #375: the cookie carries a random token and D1 holds only its SHA-256,
// so reading the `sessions` table yields nothing a browser can present.
describe("session tokens are stored hashed", () => {
  it("openSession writes a 32-byte token to the cookie and only its hash to D1", async () => {
    const userId = await seedUser();
    await openSession(userId);

    const token = cookieValue;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sessionRowIds(userId)).toEqual([await hashToken(token!)]);
    expect(await loadCurrentSession()).toEqual({ userId });
  });

  it("a row id read out of D1 does not work as a cookie", async () => {
    const userId = await seedUser();
    await openSession(userId);

    const [rowId] = await sessionRowIds(userId);
    cookieValue = rowId;
    expect(await loadCurrentSession()).toBeNull();
  });

  it("rotateSession deletes the row for the old token", async () => {
    const userId = await seedUser();
    await openSession(userId);
    const oldToken = cookieValue!;

    await rotateSession(userId);

    expect(cookieValue).not.toBe(oldToken);
    expect(await sessionRowIds(userId)).toEqual([
      await hashToken(cookieValue!),
    ]);
  });

  it("closeSession deletes the row for the cookie's token", async () => {
    const userId = await seedUser();
    await openSession(userId);

    await closeSession();

    expect(await sessionRowIds(userId)).toEqual([]);
    expect(cookieCleared).toBe(true);
  });

  it("an expired session's row is deleted when its cookie comes back", async () => {
    const { sid, userId } = await seedSession({
      expiresAt: Temporal.Now.instant().subtract({ milliseconds: 1000 }),
    });
    cookieValue = sid;

    expect(await loadCurrentSession()).toBeNull();
    expect(await sessionRowIds(userId)).toEqual([]);
  });
});
