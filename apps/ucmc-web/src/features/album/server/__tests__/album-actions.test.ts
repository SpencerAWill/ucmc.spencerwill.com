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
const { getPrivateBucket, getPublicBucket } = await import("#/server/r2");
const { albumFullKey, albumOriginalKey, putAlbumFull, putAlbumOriginal } =
  await import("#/server/r2/album-originals.server");
const { sql } = await import("drizzle-orm");

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

  it("deleting a photo removes its original and full copy", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });
    const [{ id }] = await getDb()
      .select({ id: schema.albumPhotos.id })
      .from(schema.albumPhotos)
      .where(eq(schema.albumPhotos.publicId, publicId));
    const originalKey = `album-originals/${id}/0123456789abcdef.jpg`;
    const fullKey = `album-full/${id}/0123456789abcdef.webp`;
    await getPrivateBucket().put(originalKey, new Uint8Array([1]));
    await getPrivateBucket().put(fullKey, new Uint8Array([2]));
    await getDb()
      .update(schema.albumPhotos)
      .set({ originalKey, fullKey })
      .where(eq(schema.albumPhotos.publicId, publicId));

    await deleteAlbumPhotoAction({ publicId });

    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(originalKey)).toBeNull();
    expect(await getPrivateBucket().head(fullKey)).toBeNull();
  });
});

// ── originals (create + update record a verified original) ────────────

const HASH_A = "0123456789abcdef";
const HASH_B = "fedcba9876543210";

async function seedUpload(
  photoId: string,
  hash: string,
  opts: { full?: boolean; bytes?: number } = {},
) {
  const originalKey = albumOriginalKey(photoId, hash, "image/jpeg");
  await putAlbumOriginal(
    originalKey,
    new Uint8Array(opts.bytes ?? 7).buffer,
    "image/jpeg",
  );
  let fullKey: string | null = null;
  if (opts.full !== false) {
    fullKey = albumFullKey(photoId, hash);
    await putAlbumFull(fullKey, new Uint8Array(3).buffer, {
      widthPx: 4000,
      heightPx: 3000,
    });
  }
  return { photoId, originalKey, fullKey };
}

async function rowFor(publicId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.albumPhotos)
    .where(eq(schema.albumPhotos.publicId, publicId));
  return row;
}

describe("originals on create", () => {
  it("records a verified original from the R2 heads, not the input", async () => {
    await signInAsAdmin();
    const photoId = crypto.randomUUID();
    const original = await seedUpload(photoId, HASH_A, { bytes: 11 });
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
      original,
    });
    const row = await rowFor(publicId);
    expect(row.id).toBe(photoId);
    expect(row.originalKey).toBe(original.originalKey);
    expect(row.originalBytes).toBe(11);
    expect(row.originalContentType).toBe("image/jpeg");
    expect(row.fullKey).toBe(original.fullKey);
    expect(row.fullBytes).toBe(3);
    expect(row.fullWidthPx).toBe(4000);
    expect(row.fullHeightPx).toBe(3000);
    const summary = await getAlbumPhotoByPublicIdAction({ publicId });
    expect(summary).toMatchObject({
      fullHash: HASH_A,
      originalBytes: 11,
      fullWidthPx: 4000,
      fullHeightPx: 3000,
    });
  });

  it("accepts a null fullKey and stores null full columns", async () => {
    await signInAsAdmin();
    const photoId = crypto.randomUUID();
    const original = await seedUpload(photoId, HASH_A, { full: false });
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
      original,
    });
    const row = await rowFor(publicId);
    expect(row.originalKey).toBe(original.originalKey);
    expect(row.fullKey).toBeNull();
    expect(row.fullWidthPx).toBeNull();
    expect((await getAlbumPhotoByPublicIdAction({ publicId }))!.fullHash).toBe(
      HASH_A,
    );
  });

  it("rejects an original key for a different photoId", async () => {
    await signInAsAdmin();
    const other = await seedUpload(crypto.randomUUID(), HASH_A);
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(),
        original: { ...other, photoId: crypto.randomUUID() },
      }),
    ).rejects.toThrow("Uploaded original not found");
  });

  it("rejects a key with no object behind it", async () => {
    await signInAsAdmin();
    const photoId = crypto.randomUUID();
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(),
        original: {
          photoId,
          originalKey: albumOriginalKey(photoId, HASH_A, "image/jpeg"),
          fullKey: null,
        },
      }),
    ).rejects.toThrow("Uploaded original not found");
  });

  it("rejects a full key that doesn't match the original's photoId and hash", async () => {
    await signInAsAdmin();
    const photoId = crypto.randomUUID();
    const original = await seedUpload(photoId, HASH_A);
    const wrongHash = albumFullKey(photoId, HASH_B);
    await putAlbumFull(wrongHash, new Uint8Array(3).buffer, {
      widthPx: 1,
      heightPx: 1,
    });
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(),
        original: { ...original, fullKey: wrongHash },
      }),
    ).rejects.toThrow("Uploaded original not found");
    const wrongPhoto = albumFullKey(crypto.randomUUID(), HASH_A);
    await putAlbumFull(wrongPhoto, new Uint8Array(3).buffer, {
      widthPx: 1,
      heightPx: 1,
    });
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(),
        original: { ...original, fullKey: wrongPhoto },
      }),
    ).rejects.toThrow("Uploaded original not found");
  });

  it("without original still works and stores nulls", async () => {
    await signInAsAdmin();
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(),
    });
    const row = await rowFor(publicId);
    expect(row.originalKey).toBeNull();
    expect(row.fullKey).toBeNull();
    expect(row.originalBytes).toBeNull();
    expect(row.fullBytes).toBeNull();
    expect(await getAlbumPhotoByPublicIdAction({ publicId })).toMatchObject({
      fullHash: null,
      originalBytes: null,
      fullWidthPx: null,
      fullHeightPx: null,
    });
  });
});

describe("originals on update", () => {
  async function createWithOriginal() {
    const photoId = crypto.randomUUID();
    const original = await seedUpload(photoId, HASH_A);
    const { publicId } = await createAlbumPhotoAction({
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(0x01),
      original,
    });
    return { photoId, publicId, original };
  }

  it("swaps the keys and deletes the old private objects", async () => {
    await signInAsAdmin();
    const { photoId, publicId, original: old } = await createWithOriginal();
    const next = await seedUpload(photoId, HASH_B, { bytes: 21 });
    await updateAlbumPhotoAction({
      publicId,
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(0x02),
      original: next,
    });
    const row = await rowFor(publicId);
    expect(row.originalKey).toBe(next.originalKey);
    expect(row.originalBytes).toBe(21);
    expect(row.fullKey).toBe(next.fullKey);
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(old.originalKey)).toBeNull();
    expect(await getPrivateBucket().head(old.fullKey!)).toBeNull();
    expect(await getPrivateBucket().head(next.originalKey)).not.toBeNull();
  });

  it("rejects an original whose photoId isn't the row being edited", async () => {
    await signInAsAdmin();
    const { publicId } = await createWithOriginal();
    const stray = await seedUpload(crypto.randomUUID(), HASH_B);
    await expect(
      updateAlbumPhotoAction({ publicId, ...VALID_PHOTO, original: stray }),
    ).rejects.toThrow("Uploaded original not found");
  });

  it("a text-only update leaves the private keys untouched", async () => {
    await signInAsAdmin();
    const { publicId, original } = await createWithOriginal();
    const before = await rowFor(publicId);
    await updateAlbumPhotoAction({
      publicId,
      ...VALID_PHOTO,
      caption: "Renamed",
    });
    await new Promise((r) => setTimeout(r, 50));
    const after = await rowFor(publicId);
    expect(after.originalKey).toBe(before.originalKey);
    expect(after.fullKey).toBe(before.fullKey);
    expect(after.originalBytes).toBe(before.originalBytes);
    expect(await getPrivateBucket().head(original.originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).not.toBeNull();
  });

  it("a new crop without a new original leaves the original columns alone", async () => {
    await signInAsAdmin();
    const { publicId, original } = await createWithOriginal();
    await updateAlbumPhotoAction({
      publicId,
      ...VALID_PHOTO,
      imageDataUrl: makeWebpDataUrl(0x02),
    });
    const row = await rowFor(publicId);
    expect(row.originalKey).toBe(original.originalKey);
    expect(row.fullKey).toBe(original.fullKey);
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(original.originalKey)).not.toBeNull();
  });

  it("cleans up new private keys when the UPDATE fails", async () => {
    await signInAsAdmin();
    const { photoId, publicId, original: old } = await createWithOriginal();
    const before = await rowFor(publicId);
    const next = await seedUpload(photoId, HASH_B);
    const db = getDb();
    await db.run(
      sql`CREATE TRIGGER album_photos_test_fail BEFORE UPDATE ON album_photos BEGIN SELECT RAISE(ABORT, 'forced'); END`,
    );
    try {
      await expect(
        updateAlbumPhotoAction({
          publicId,
          ...VALID_PHOTO,
          imageDataUrl: makeWebpDataUrl(0x02),
          original: next,
        }),
      ).rejects.toThrow();
    } finally {
      await db.run(sql`DROP TRIGGER album_photos_test_fail`);
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(next.originalKey)).toBeNull();
    expect(await getPrivateBucket().head(next.fullKey!)).toBeNull();
    expect(await getPrivateBucket().head(old.originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(old.fullKey!)).not.toBeNull();
    expect(await rowFor(publicId)).toEqual(before);
  });

  async function withFailingTrigger(
    event: "UPDATE" | "INSERT",
    fn: () => Promise<void>,
  ) {
    const db = getDb();
    await db.run(
      sql.raw(
        `CREATE TRIGGER album_photos_test_fail BEFORE ${event} ON album_photos BEGIN SELECT RAISE(ABORT, 'forced'); END`,
      ),
    );
    try {
      await fn();
    } finally {
      await db.run(sql`DROP TRIGGER album_photos_test_fail`);
    }
  }

  it("refuses a create that reuses a photoId, and keeps the first row's objects", async () => {
    await signInAsAdmin();
    const { original } = await createWithOriginal();
    await expect(
      createAlbumPhotoAction({
        ...VALID_PHOTO,
        imageDataUrl: makeWebpDataUrl(0x03),
        original,
      }),
    ).rejects.toThrow("Uploaded original not found");
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(original.originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).not.toBeNull();
  });

  it("deletes the new private keys when the INSERT fails", async () => {
    await signInAsAdmin();
    const original = await seedUpload(crypto.randomUUID(), HASH_A);
    await withFailingTrigger("INSERT", async () => {
      await expect(
        createAlbumPhotoAction({
          ...VALID_PHOTO,
          imageDataUrl: makeWebpDataUrl(),
          original,
        }),
      ).rejects.toThrow();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(original.originalKey)).toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).toBeNull();
  });

  // Local R2 deletes finish before the next head(), which would hide a
  // fire-and-forget delete; hold each private delete back to expose one.
  function slowPrivateDeletes() {
    const bucket = getPrivateBucket();
    const real = bucket.delete.bind(bucket);
    return vi.spyOn(bucket, "delete").mockImplementation(async (keys) => {
      await new Promise((r) => setTimeout(r, 100));
      return real(keys);
    });
  }

  it("a failed update has removed its new private keys by the time it rejects", async () => {
    await signInAsAdmin();
    const { photoId, publicId } = await createWithOriginal();
    const next = await seedUpload(photoId, HASH_B);
    const slow = slowPrivateDeletes();
    await withFailingTrigger("UPDATE", async () => {
      await expect(
        updateAlbumPhotoAction({
          publicId,
          ...VALID_PHOTO,
          imageDataUrl: makeWebpDataUrl(0x02),
          original: next,
        }),
      ).rejects.toThrow();
    });
    slow.mockRestore();
    // No sleep: the dialog re-uploads these very keys right after.
    expect(await getPrivateBucket().head(next.originalKey)).toBeNull();
    expect(await getPrivateBucket().head(next.fullKey!)).toBeNull();
  });

  it("a failed create has removed its private keys by the time it rejects", async () => {
    await signInAsAdmin();
    const original = await seedUpload(crypto.randomUUID(), HASH_A);
    const slow = slowPrivateDeletes();
    await withFailingTrigger("INSERT", async () => {
      await expect(
        createAlbumPhotoAction({
          ...VALID_PHOTO,
          imageDataUrl: makeWebpDataUrl(),
          original,
        }),
      ).rejects.toThrow();
    });
    slow.mockRestore();
    expect(await getPrivateBucket().head(original.originalKey)).toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).toBeNull();
  });

  // The pre-insert "is the id taken" check is not atomic, and
  // albumPhotoIdTaken is module-internal, so it can't be spied directly.
  // Instead the first select from album_photos (that pre-check) is made to
  // report "not taken" while the winner's row, same id and keys, already
  // exists, so the create's own insert then loses the primary-key race.
  it("a create that loses the photoId race leaves the winner's private objects", async () => {
    await signInAsAdmin();
    const original = await seedUpload(crypto.randomUUID(), HASH_A);
    const db = getDb();
    await db.insert(schema.albumPhotos).values({
      id: original.photoId,
      publicId: "winner",
      altText: "winner",
      imageKey: "gallery/winner.webp",
      imageBytes: 1,
      widthPx: 1,
      heightPx: 1,
      originalKey: original.originalKey,
      fullKey: original.fullKey,
    });
    const realSelect = db.select.bind(db) as (...a: unknown[]) => {
      from: (t: unknown) => unknown;
    };
    let hidden = false;
    const spy = vi.spyOn(db, "select").mockImplementation(((
      ...args: unknown[]
    ) => {
      const real = realSelect(...args);
      return {
        from: (t: unknown) => {
          if (t === schema.albumPhotos && !hidden) {
            hidden = true;
            return { where: () => ({ limit: () => Promise.resolve([]) }) };
          }
          return real.from(t);
        },
      };
    }) as never);
    try {
      await expect(
        createAlbumPhotoAction({
          ...VALID_PHOTO,
          imageDataUrl: makeWebpDataUrl(),
          original,
        }),
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(hidden).toBe(true);
    expect(await getPrivateBucket().head(original.originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).not.toBeNull();
  });

  it("keeps shared keys when the same original is re-sent, on success and on failure", async () => {
    await signInAsAdmin();
    const { publicId, original } = await createWithOriginal();
    await updateAlbumPhotoAction({ publicId, ...VALID_PHOTO, original });
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(original.originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).not.toBeNull();

    await withFailingTrigger("UPDATE", async () => {
      await expect(
        updateAlbumPhotoAction({ publicId, ...VALID_PHOTO, original }),
      ).rejects.toThrow();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPrivateBucket().head(original.originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(original.fullKey!)).not.toBeNull();
  });

  it("keeps the row's clean copy when the same original is re-sent with a null fullKey", async () => {
    await signInAsAdmin();
    const { publicId, original } = await createWithOriginal();
    const before = await rowFor(publicId);
    await updateAlbumPhotoAction({
      publicId,
      ...VALID_PHOTO,
      original: { ...original, fullKey: null },
    });
    await new Promise((r) => setTimeout(r, 50));
    const after = await rowFor(publicId);
    expect(after.fullKey).toBe(before.fullKey);
    expect(after.fullWidthPx).toBe(4000);
    expect(after.fullHeightPx).toBe(3000);
    expect(after.fullBytes).toBe(before.fullBytes);
    expect(await getPrivateBucket().head(original.fullKey!)).not.toBeNull();
  });
});
