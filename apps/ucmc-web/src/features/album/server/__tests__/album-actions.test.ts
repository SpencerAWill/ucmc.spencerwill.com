import { eq } from "drizzle-orm";
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

const {
  createAlbumPhotoAction,
  deleteAlbumPhotoAction,
  getAlbumPhotoByPublicIdAction,
  getAlbumPhotosAction,
  updateAlbumPhotoAction,
} = await import("#/features/album/server/album-actions.server");
const { ALBUM_R2_PREFIX } = await import("#/features/album/lib/image-url");
const { openSession } = await import("#/server/auth/session.server");
const { getPublicBucket } = await import("#/server/r2");

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

async function signInAsMember(email = "member@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

/**
 * Build a minimal-but-valid WebP dataUrl. Real WebPs start with a
 * "RIFF" header, a 4-byte size, then "WEBP". The `variant` byte
 * makes it possible to produce two distinct payloads with different
 * content hashes for the replace-on-update test path.
 */
function makeWebpDataUrl(variant = 0x08): string {
  const bytes = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    0x1a,
    0x00,
    0x00,
    0x00, // size (unchecked by our magic test)
    0x57,
    0x45,
    0x42,
    0x50, // WEBP
    0x56,
    0x50,
    0x38,
    0x4c, // VP8L (lossless WebP)
    0x0d,
    0x00,
    0x00,
    0x00, // chunk size
    0x2f,
    0x00,
    0x00,
    0x00, // signature byte + width/height bits
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x88,
    0x88,
    variant,
  ]);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

const VALID_PHOTO = {
  caption: "Sunset on Mt. Washington",
  credit: "J. Doe",
  takenAt: new Date("2024-10-15T00:00:00Z"),
  tag: "mountaineering",
  altText: "A sunset over a mountain summit",
  widthPx: 1600,
  heightPx: 1200,
};

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.albumPhotos);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);

  const bucket = getPublicBucket();
  let cursor: string | undefined;
  let truncated = true;
  while (truncated) {
    const page = await bucket.list({
      prefix: ALBUM_R2_PREFIX,
      cursor,
      limit: 1000,
    });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((o) => o.key));
    }
    truncated = page.truncated;
    cursor = page.truncated ? page.cursor : undefined;
  }
});

// ── reads ──────────────────────────────────────────────────────────────

describe("getAlbumPhotosAction (read)", () => {
  it("returns an empty list when the archive is empty", async () => {
    const { photos } = await getAlbumPhotosAction();
    expect(photos).toEqual([]);
  });

  it("orders by takenAt DESC with createdAt fallback for null takenAt rows", async () => {
    await signInAsAdmin();
    // Older photo with explicit takenAt
    await createAlbumPhotoAction({
      ...VALID_PHOTO,
      caption: "Older",
      takenAt: new Date("2022-01-01T00:00:00Z"),
      imageDataUrl: makeWebpDataUrl(0x01),
    });
    // Newer photo
    await createAlbumPhotoAction({
      ...VALID_PHOTO,
      caption: "Newer",
      takenAt: new Date("2024-01-01T00:00:00Z"),
      imageDataUrl: makeWebpDataUrl(0x02),
    });
    // No takenAt — falls back to createdAt (which is most-recent insert)
    await createAlbumPhotoAction({
      ...VALID_PHOTO,
      caption: "Undated",
      takenAt: null,
      imageDataUrl: makeWebpDataUrl(0x03),
    });

    const { photos } = await getAlbumPhotosAction();
    // The undated one was just inserted, so its createdAt is newest;
    // the newer-takenAt row beats the older.
    expect(photos.map((p) => p.caption)).toEqual(["Undated", "Newer", "Older"]);
  });
});

// ── create (public_album:manage) ─────────────────────────────────────

describe("createAlbumPhotoAction", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(),
      }),
    ).rejects.toThrow(/not signed in/i);
  });

  it("rejects callers without public_album:manage", async () => {
    await signInAsMember();
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(),
      }),
    ).rejects.toThrow(/public_album:manage/);
  });

  it("inserts the row, uploads the image, and emits an audit event", async () => {
    const actorId = await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });

    const row = await getAlbumPhotoByPublicIdAction({ publicId });
    expect(row).not.toBeNull();
    expect(row!.caption).toBe("Sunset on Mt. Washington");
    expect(row!.tag).toBe("mountaineering");
    expect(row!.altText).toBe("A sunset over a mountain summit");
    // The R2 prefix is still the historical `gallery/` — asserted via
    // the exported constant rather than a literal so this can't be the
    // thing that silently drifts (it already did once, during the Trip
    // Gallery → Album rename).
    expect(row!.imageKey).toMatch(
      new RegExp(`^${ALBUM_R2_PREFIX}[0-9a-z-]+/[a-f0-9]{16}\\.webp$`),
    );
    expect(row!.imageBytes).toBeGreaterThan(0);
    expect(row!.widthPx).toBe(1600);
    expect(row!.heightPx).toBe(1200);

    // R2 object exists.
    const bucket = getPublicBucket();
    const obj = await bucket.head(row!.imageKey);
    expect(obj).not.toBeNull();

    // Audit event with expected metadata.
    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "album_photo.created"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    const meta = JSON.parse(auditRows[0].metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.tag).toBe("mountaineering");
  });

  it("rejects payloads without the RIFF/WEBP magic header", async () => {
    await signInAsAdmin();
    // Encode something that isn't a WebP — PDF header (%PDF).
    const notWebp = `data:image/webp;base64,${btoa("%PDF-1.4\n%%EOF")}`;
    await expect(
      createAlbumPhotoAction({ ...VALID_PHOTO, imageDataUrl: notWebp }),
    ).rejects.toThrow(/RIFF\/WEBP/);
  });
});

// ── update (public_album:manage) ─────────────────────────────────────

describe("updateAlbumPhotoAction", () => {
  it("rejects callers without public_album:manage", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });
    await signInAsMember();

    await expect(
      updateAlbumPhotoAction({
        publicId,
        ...VALID_PHOTO,
        caption: "Updated",
      }),
    ).rejects.toThrow(/public_album:manage/);
  });

  it("metadata-only edit leaves the R2 object alone", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });
    const before = await getAlbumPhotoByPublicIdAction({ publicId });

    await updateAlbumPhotoAction({
      publicId,
      ...VALID_PHOTO,
      caption: "Renamed",
    });
    const after = await getAlbumPhotoByPublicIdAction({ publicId });

    expect(after!.caption).toBe("Renamed");
    expect(after!.imageKey).toBe(before!.imageKey);
    expect(after!.imageBytes).toBe(before!.imageBytes);

    const obj = await getPublicBucket().head(after!.imageKey);
    expect(obj).not.toBeNull();
  });

  it("replacing the image uploads the new key and deletes the old one", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(0x01),
    });
    const before = await getAlbumPhotoByPublicIdAction({ publicId });

    await updateAlbumPhotoAction({
      publicId,
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(0x02),
    });
    const after = await getAlbumPhotoByPublicIdAction({ publicId });

    expect(after!.imageKey).not.toBe(before!.imageKey);

    // Best-effort delete is fire-and-forget; give it a beat.
    await new Promise((r) => setTimeout(r, 50));
    const oldObj = await getPublicBucket().head(before!.imageKey);
    expect(oldObj).toBeNull();
    const newObj = await getPublicBucket().head(after!.imageKey);
    expect(newObj).not.toBeNull();
  });
});

// ── delete (public_album:manage) ─────────────────────────────────────

describe("deleteAlbumPhotoAction", () => {
  it("rejects callers without public_album:manage", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });
    await signInAsMember();

    await expect(deleteAlbumPhotoAction({ publicId })).rejects.toThrow(
      /public_album:manage/,
    );
  });

  it("removes the row, the R2 object, and writes an audit event", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });
    const row = await getAlbumPhotoByPublicIdAction({ publicId });
    expect(row).not.toBeNull();

    await deleteAlbumPhotoAction({ publicId });
    expect(await getAlbumPhotoByPublicIdAction({ publicId })).toBeNull();

    await new Promise((r) => setTimeout(r, 50));
    const obj = await getPublicBucket().head(row!.imageKey);
    expect(obj).toBeNull();

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "album_photo.deleted"));
    expect(auditRows).toHaveLength(1);
  });
});
