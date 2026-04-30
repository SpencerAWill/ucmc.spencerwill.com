import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

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

const { uploadAvatarAction, removeAvatarAction } =
  await import("#/features/auth/server/avatar-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { getBucket } = await import("#/server/r2");

// ── helpers ────────────────────────────────────────────────────────────

async function seedApprovedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    email,
    status: "approved",
  });
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: new Date(),
  });
  return id;
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

// Smallest valid WebP — VP8L 1×1 transparent. Built once per test from
// fixed bytes so each test gets a deterministic content hash.
function makeWebpDataUrl(): string {
  // RIFF + 30-byte payload (size 26 = total 34) for a 1×1 lossless WebP.
  // Generated from `cwebp -lossless` on a 1×1 transparent PNG; bytes
  // baked in here to keep the test runtime independent of any encoder.
  const bytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08,
  ]);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

function makeAlternateWebpDataUrl(): string {
  // Same shape, different middle byte → different content hash.
  const bytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x09,
  ]);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

beforeEach(() => {
  cookieJar.clear();
});

// ── tests ──────────────────────────────────────────────────────────────

describe("uploadAvatarAction", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      uploadAvatarAction({ dataUrl: makeWebpDataUrl() }),
    ).rejects.toThrow(/Not authorized/);
  });

  it("stores the avatar in R2 and writes the key to the profile", async () => {
    const userId = await seedApprovedUser("upload@example.com");
    await signInAs(userId);

    const result = await uploadAvatarAction({ dataUrl: makeWebpDataUrl() });

    expect(result.ok).toBe(true);
    expect(result.avatarKey).toMatch(
      new RegExp(`^avatars/${userId}/[a-f0-9]{16}\\.webp$`),
    );

    const stored = await getBucket().head(result.avatarKey);
    expect(stored).not.toBeNull();

    const profile = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, userId),
      columns: { avatarKey: true },
    });
    expect(profile?.avatarKey).toBe(result.avatarKey);
  });

  it("deletes the prior R2 object when the avatar is replaced", async () => {
    const userId = await seedApprovedUser("replace@example.com");
    await signInAs(userId);

    const first = await uploadAvatarAction({ dataUrl: makeWebpDataUrl() });
    const second = await uploadAvatarAction({
      dataUrl: makeAlternateWebpDataUrl(),
    });

    expect(second.avatarKey).not.toBe(first.avatarKey);
    expect(await getBucket().head(first.avatarKey)).toBeNull();
    expect(await getBucket().head(second.avatarKey)).not.toBeNull();
  });

  it("rejects payloads where the bytes don't match the declared content type", async () => {
    const userId = await seedApprovedUser("magic@example.com");
    await signInAs(userId);

    // Claims WebP but bytes are ASCII text.
    const fakeDataUrl = `data:image/webp;base64,${btoa("not an image at all")}`;
    await expect(uploadAvatarAction({ dataUrl: fakeDataUrl })).rejects.toThrow(
      /do not match/,
    );
  });

  it("rejects payloads larger than the byte ceiling", async () => {
    const userId = await seedApprovedUser("oversize@example.com");
    await signInAs(userId);

    // 250 KB of zeros, prefixed with the WebP magic so it survives the
    // magic-byte check and trips the size guard instead.
    const padding = new Uint8Array(250 * 1024);
    padding[0] = 0x52;
    padding[1] = 0x49;
    padding[2] = 0x46;
    padding[3] = 0x46;
    padding[8] = 0x57;
    padding[9] = 0x45;
    padding[10] = 0x42;
    padding[11] = 0x50;
    let binary = "";
    for (const b of padding) {
      binary += String.fromCharCode(b);
    }
    const dataUrl = `data:image/webp;base64,${btoa(binary)}`;
    await expect(uploadAvatarAction({ dataUrl })).rejects.toThrow(/exceeds/);
  });
});

describe("removeAvatarAction", () => {
  it("clears the column and deletes the R2 object", async () => {
    const userId = await seedApprovedUser("remove@example.com");
    await signInAs(userId);

    const { avatarKey } = await uploadAvatarAction({
      dataUrl: makeWebpDataUrl(),
    });
    expect(await getBucket().head(avatarKey)).not.toBeNull();

    const result = await removeAvatarAction();
    expect(result.ok).toBe(true);

    const profile = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, userId),
      columns: { avatarKey: true },
    });
    expect(profile?.avatarKey).toBeNull();
    expect(await getBucket().head(avatarKey)).toBeNull();
  });

  it("is a no-op when no avatar is set", async () => {
    const userId = await seedApprovedUser("noop@example.com");
    await signInAs(userId);

    await expect(removeAvatarAction()).resolves.toEqual({ ok: true });
  });
});
