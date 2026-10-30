/**
 * GET /api/avatars/$ — the local-dev avatar route. It follows the
 * `/members` directory policy: approved members see every avatar, an
 * account awaiting approval sees only its own (#381), signed-out
 * visitors see none.
 */
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

const { openSession } = await import("#/server/auth/session.server");
const { avatarKey, putAvatar } = await import("#/server/r2/avatars.server");
const { Route } = await import("#/routes/api/avatars.$");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(status: schema.UserStatus): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status,
    });
  await attachPrimaryEmail(id, `${id}@example.com`);
  return id;
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

/** Stores a one-byte avatar for `userId` and returns its key. */
async function storeAvatar(userId: string): Promise<string> {
  const key = avatarKey(userId, "0123456789abcdef", "image/webp");
  await putAvatar(key, new Uint8Array([1]).buffer, "image/webp");
  return key;
}

async function callGet(key: string): Promise<Response> {
  const handlers = (
    Route.options as unknown as {
      server: {
        handlers: {
          GET: (ctx: { params: { _splat?: string } }) => Promise<Response>;
        };
      };
    }
  ).server.handlers;
  return handlers.GET({ params: { _splat: key } });
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

// ── tests ──────────────────────────────────────────────────────────────

describe("GET /api/avatars/$", () => {
  it("refuses a signed-out visitor", async () => {
    const key = await storeAvatar(await seedUser("approved"));
    expect((await callGet(key)).status).toBe(401);
  });

  it("serves another member's avatar to an approved member", async () => {
    const key = await storeAvatar(await seedUser("approved"));
    await signInAs(await seedUser("approved"));
    const res = await callGet(key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("refuses another member's avatar to an account awaiting approval", async () => {
    const key = await storeAvatar(await seedUser("approved"));
    await signInAs(await seedUser("pending"));
    expect((await callGet(key)).status).toBe(403);
  });

  it("serves an account awaiting approval its own avatar", async () => {
    // The account chrome and /register/pending render it before approval.
    const pendingId = await seedUser("pending");
    const key = await storeAvatar(pendingId);
    await signInAs(pendingId);
    expect((await callGet(key)).status).toBe(200);
  });
});
