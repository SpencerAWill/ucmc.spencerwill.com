import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UPLOAD_NO_FILE,
  UPLOAD_NOT_AN_IMAGE,
  UPLOAD_PHOTO_GONE,
  UPLOAD_RATE_LIMITED,
  UPLOAD_STORE_FAILED,
  uploadTooLargeMessage,
} from "#/features/album/lib/upload-messages";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";
import { jpegWithApp1, tiff } from "#/server/r2/__tests__/exif-fixtures";

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

const mocks = vi.hoisted(() => ({
  rateLimitOk: true,
  input: vi.fn(),
  output: vi.fn(),
  info: vi.fn(),
  response: vi.fn(),
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkUploadRateLimit: async () => mocks.rateLimitOk,
}));

vi.mock("#/server/images", () => ({
  getImages: () => ({ input: mocks.input, info: mocks.info }),
}));

const { getAlbumFullImageAction, uploadAlbumOriginalAction } =
  await import("#/features/album/server/album-original-actions.server");
const { parseAlbumFullKey, parseAlbumOriginalKey } =
  await import("#/server/r2/album-originals.server");
const { openSession } = await import("#/server/auth/session.server");
const { getPrivateBucket } = await import("#/server/r2");

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

async function signInWithRole(email: string, roleId: string): Promise<string> {
  const userId = await seedUser(email);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

const signInAsAdmin = () =>
  signInWithRole("admin@example.com", "role_system_admin");
const signInAsMember = () =>
  signInWithRole("member@example.com", "role_member");

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
// A minimal RIFF WebP (one `VP8 ` chunk, no metadata): the clean copy
// walks its chunks and refuses anything it can't.
// Every byte is ASCII, so UTF-8 encoding writes them as given.
const WEBP_OUT = new TextEncoder().encode(
  "RIFF\x10\0\0\0WEBPVP8 \x04\0\0\0\x07\x07\x07\x07",
).buffer;

function formOf(bytes: Uint8Array, type: string, photoId?: string): FormData {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], "photo", { type }),
  );
  if (photoId !== undefined) {
    form.append("photoId", photoId);
  }
  return form;
}

async function privateKeys(): Promise<string[]> {
  const page = await getPrivateBucket().list({ prefix: "album-" });
  return page.objects.map((o) => o.key);
}

beforeEach(async () => {
  cookieJar.clear();
  mocks.rateLimitOk = true;
  vi.resetAllMocks();
  mocks.input.mockReturnValue({ output: mocks.output });
  mocks.output.mockResolvedValue({ response: mocks.response });
  mocks.response.mockImplementation(() => new Response(WEBP_OUT));
  mocks.info.mockResolvedValue({
    format: "image/webp",
    fileSize: 4,
    width: 3024,
    height: 4032,
  });

  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.albumPhotos);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);

  const bucket = getPrivateBucket();
  const keys = await privateKeys();
  if (keys.length > 0) {
    await bucket.delete(keys);
  }
});

// ── tests ──────────────────────────────────────────────────────────────

describe("uploadAlbumOriginalAction", () => {
  it("requires public_album:manage", async () => {
    await signInAsMember();
    await expect(
      uploadAlbumOriginalAction(formOf(JPEG, "image/jpeg")),
    ).rejects.toThrow(/Forbidden/);
  });

  it("is rate-limited per user", async () => {
    await signInAsAdmin();
    mocks.rateLimitOk = false;
    await expect(
      uploadAlbumOriginalAction(formOf(JPEG, "image/jpeg")),
    ).rejects.toThrow(UPLOAD_RATE_LIMITED);
    expect(await privateKeys()).toEqual([]);
  });

  it("rejects a missing file", async () => {
    await signInAsAdmin();
    await expect(uploadAlbumOriginalAction(new FormData())).rejects.toThrow(
      UPLOAD_NO_FILE,
    );
    expect(await privateKeys()).toEqual([]);
  });

  it("rejects a file over 12 MB", async () => {
    await signInAsAdmin();
    const big = new Uint8Array(12 * 1024 * 1024 + 1);
    big.set(JPEG);
    await expect(
      uploadAlbumOriginalAction(formOf(big, "image/jpeg")),
    ).rejects.toThrow(uploadTooLargeMessage(big.byteLength));
    expect(await privateKeys()).toEqual([]);
  });

  it("rejects a declared type outside JPEG, PNG and WebP", async () => {
    await signInAsAdmin();
    await expect(
      uploadAlbumOriginalAction(formOf(JPEG, "image/gif")),
    ).rejects.toThrow(UPLOAD_NOT_AN_IMAGE);
    expect(await privateKeys()).toEqual([]);
  });

  it("rejects HEIC bytes declared as JPEG and writes nothing", async () => {
    await signInAsAdmin();
    const heic = Uint8Array.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    await expect(
      uploadAlbumOriginalAction(formOf(heic, "image/jpeg")),
    ).rejects.toThrow(UPLOAD_NOT_AN_IMAGE);
    expect(await privateKeys()).toEqual([]);
    expect(mocks.input).not.toHaveBeenCalled();
  });

  it("rethrows a fixed message when the R2 put fails", async () => {
    await signInAsAdmin();
    const bucket = getPrivateBucket();
    vi.spyOn(bucket, "put").mockRejectedValueOnce(
      new Error("R2: secret internal detail"),
    );
    const err = await uploadAlbumOriginalAction(
      formOf(JPEG, "image/jpeg"),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(UPLOAD_STORE_FAILED);
  });

  it("rejects an unknown photoId on edit", async () => {
    await signInAsAdmin();
    await expect(
      uploadAlbumOriginalAction(
        formOf(JPEG, "image/jpeg", "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6b"),
      ),
    ).rejects.toThrow(UPLOAD_PHOTO_GONE);
    expect(await privateKeys()).toEqual([]);
  });

  it("reuses an existing row's id on edit", async () => {
    await signInAsAdmin();
    const id = "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6b";
    await getDb().insert(schema.albumPhotos).values({
      id,
      publicId: "abcdef123456",
      altText: "alt",
      imageKey: "gallery/x/y.webp",
      imageBytes: 1,
      widthPx: 1600,
      heightPx: 1200,
    });
    const result = await uploadAlbumOriginalAction(
      formOf(PNG, "image/png", id),
    );
    expect(result.photoId).toBe(id);
  });

  it("stores the original and the full copy under one minted uuid", async () => {
    await signInAsAdmin();
    const result = await uploadAlbumOriginalAction(formOf(PNG, "image/png"));

    const original = parseAlbumOriginalKey(result.originalKey);
    const full = parseAlbumFullKey(result.fullKey ?? "");
    expect(original?.photoId).toBe(result.photoId);
    expect(full?.photoId).toBe(result.photoId);
    expect(original?.contentType).toBe("image/png");
    expect(full?.hash).toBe(original?.hash);
    expect(result.originalBytes).toBe(PNG.byteLength);
    expect(result.fullWidthPx).toBe(3024);
    expect(result.fullHeightPx).toBe(4032);
    expect(result.takenDate).toBeNull();

    const bucket = getPrivateBucket();
    expect(await bucket.head(result.originalKey)).not.toBeNull();
    const fullObject = await bucket.head(result.fullKey ?? "");
    expect(fullObject?.customMetadata).toEqual({
      widthPx: "3024",
      heightPx: "4032",
    });
  });

  it("returns the EXIF date", async () => {
    await signInAsAdmin();
    const jpeg = jpegWithApp1(
      tiff({ order: "II", exif: { DateTimeOriginal: "2024:09:14 15:42:07" } }),
    );
    const result = await uploadAlbumOriginalAction(formOf(jpeg, "image/jpeg"));
    expect(result.takenDate).toBe("2024-09-14");
  });

  it("keeps the original when the binding fails", async () => {
    await signInAsAdmin();
    mocks.output.mockRejectedValue(new Error("9422"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await uploadAlbumOriginalAction(formOf(JPEG, "image/jpeg"));

    expect(result.fullKey).toBeNull();
    expect(result.fullWidthPx).toBeNull();
    expect(result.fullHeightPx).toBeNull();
    expect(await getPrivateBucket().head(result.originalKey)).not.toBeNull();
    expect(await privateKeys()).toEqual([result.originalKey]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── full-size route ────────────────────────────────────────────────────

const PHOTO_ID = "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6b";
const PUBLIC_ID = "abcdef123456";
const HASH = "a1b2c3d4e5f60718";
const FILE = `${HASH}.webp`;
const ORIGINAL_KEY = `album-originals/${PHOTO_ID}/${HASH}.jpg`;
const FULL_KEY = `album-full/${PHOTO_ID}/${HASH}.webp`;
const STORED_FULL = new Uint8Array([9, 9, 9]);

async function seedPhoto(opts: {
  original?: boolean;
  full?: boolean;
  originalObject?: boolean;
}): Promise<void> {
  const { original = true, full = true, originalObject = true } = opts;
  await getDb()
    .insert(schema.albumPhotos)
    .values({
      id: PHOTO_ID,
      publicId: PUBLIC_ID,
      altText: "alt",
      imageKey: "gallery/x/y.webp",
      imageBytes: 1,
      widthPx: 1600,
      heightPx: 1200,
      originalKey: original ? ORIGINAL_KEY : null,
      fullKey: original && full ? FULL_KEY : null,
      fullBytes: original && full ? STORED_FULL.byteLength : null,
    });
  const bucket = getPrivateBucket();
  if (original && originalObject) {
    await bucket.put(ORIGINAL_KEY, JPEG);
  }
  if (original && full) {
    await bucket.put(FULL_KEY, STORED_FULL);
  }
}

async function bytesOf(
  image: { body: ReadableStream } | null,
): Promise<number[]> {
  return Array.from(
    new Uint8Array(await new Response(image?.body).arrayBuffer()),
  );
}

async function photoRow() {
  return getDb()
    .select()
    .from(schema.albumPhotos)
    .where(eq(schema.albumPhotos.id, PHOTO_ID))
    .get();
}

describe("getAlbumFullImageAction", () => {
  it("returns null for each refusal", async () => {
    await seedPhoto({});
    const legacyId = "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6c";
    await getDb().insert(schema.albumPhotos).values({
      id: legacyId,
      publicId: "legacy123456",
      altText: "alt",
      imageKey: "gallery/l/l.webp",
      imageBytes: 1,
      widthPx: 1600,
      heightPx: 1200,
    });

    // signed out
    cookieJar.clear();
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();

    // a member without the grant
    await signInAsMember();
    const grant = {
      roleId: "role_member",
      permissionId: "perm_public_album_view_original",
    };
    await getDb()
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, grant.roleId),
          eq(schema.rolePermissions.permissionId, grant.permissionId),
        ),
      );
    try {
      expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();
    } finally {
      await getDb().insert(schema.rolePermissions).values(grant);
    }

    // with the grant: unknown, legacy, stale and malformed names
    expect(await getAlbumFullImageAction("nope00000000", FILE)).toBeNull();
    expect(await getAlbumFullImageAction("legacy123456", FILE)).toBeNull();
    expect(
      await getAlbumFullImageAction(PUBLIC_ID, "ffffffffffffffff.webp"),
    ).toBeNull();
    expect(
      await getAlbumFullImageAction(PUBLIC_ID, `${HASH}.webp/`),
    ).toBeNull();
    expect(await getAlbumFullImageAction(PUBLIC_ID, "../x.webp")).toBeNull();
    // and the control: the same member gets the photo
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).not.toBeNull();
  });

  it("serves the stored full copy to a member", async () => {
    await seedPhoto({});
    await signInAsMember();
    const image = await getAlbumFullImageAction(PUBLIC_ID, FILE);
    expect(image?.bytes).toBe(3);
    expect(await bytesOf(image)).toEqual([9, 9, 9]);
    expect(mocks.input).not.toHaveBeenCalled();
  });

  it("self-repairs a missing full copy", async () => {
    await seedPhoto({ full: false });
    await signInAsMember();
    const image = await getAlbumFullImageAction(PUBLIC_ID, FILE);
    expect(await bytesOf(image)).toEqual([...new Uint8Array(WEBP_OUT)]);
    const row = await photoRow();
    expect(row).toMatchObject({
      fullKey: FULL_KEY,
      fullWidthPx: 3024,
      fullHeightPx: 4032,
      fullBytes: WEBP_OUT.byteLength,
    });
    expect(await getPrivateBucket().head(FULL_KEY)).not.toBeNull();
  });

  it("a lost self-repair race doesn't error", async () => {
    await seedPhoto({ full: false });
    await signInAsMember();
    // The other viewer finishes while this one is still rendering.
    mocks.output.mockImplementation(async () => {
      await getDb()
        .update(schema.albumPhotos)
        .set({
          fullKey: FULL_KEY,
          fullWidthPx: 1,
          fullHeightPx: 2,
          fullBytes: 99,
        })
        .where(eq(schema.albumPhotos.id, PHOTO_ID));
      return { response: mocks.response };
    });
    const image = await getAlbumFullImageAction(PUBLIC_ID, FILE);
    expect(await bytesOf(image)).toEqual([...new Uint8Array(WEBP_OUT)]);
    // The guarded UPDATE matched nothing, so the winner's columns stand.
    expect(await photoRow()).toMatchObject({
      fullWidthPx: 1,
      fullHeightPx: 2,
      fullBytes: 99,
    });
  });

  it("returns null when self-repair fails", async () => {
    await seedPhoto({ full: false });
    await signInAsMember();
    mocks.output.mockRejectedValue(new Error("9422"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();
    expect((await photoRow())?.fullKey).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is refused under view-as for a role without the permission", async () => {
    await seedPhoto({});
    const adminId = await signInAsAdmin();
    await getDb()
      .insert(schema.userRoles)
      .values({ userId: adminId, roleId: "role_advisor" });
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).not.toBeNull();
    // Re-resolved per request: the principal now holds the advisor role too.
    cookieJar.set("ucmc_view_as", "advisor");
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();
  });

  it("never lets a render of a replaced original write onto the new row", async () => {
    await seedPhoto({ full: false });
    await signInAsMember();
    const NEW_KEY = `album-originals/${PHOTO_ID}/ffffffffffffffff.jpg`;
    mocks.output.mockImplementation(async () => {
      await getDb()
        .update(schema.albumPhotos)
        .set({ originalKey: NEW_KEY })
        .where(eq(schema.albumPhotos.id, PHOTO_ID));
      return { response: mocks.response };
    });
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();
    const row = await photoRow();
    expect(row?.originalKey).toBe(NEW_KEY);
    expect(row?.fullKey).toBeNull();
    expect(row?.fullWidthPx).toBeNull();
  });

  it("repairs a full_key that doesn't match the current original", async () => {
    await seedPhoto({});
    await getDb()
      .update(schema.albumPhotos)
      .set({ fullKey: `album-full/${PHOTO_ID}/ffffffffffffffff.webp` })
      .where(eq(schema.albumPhotos.id, PHOTO_ID));
    await signInAsMember();
    const image = await getAlbumFullImageAction(PUBLIC_ID, FILE);
    expect(await bytesOf(image)).toEqual([...new Uint8Array(WEBP_OUT)]);
  });

  it("returns null when the original object is gone", async () => {
    await seedPhoto({ full: false, originalObject: false });
    await signInAsMember();
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();
  });

  it("returns null when the stored full object is missing", async () => {
    await seedPhoto({});
    await getPrivateBucket().delete(FULL_KEY);
    await signInAsMember();
    expect(await getAlbumFullImageAction(PUBLIC_ID, FILE)).toBeNull();
  });
});

describe("GET /api/album-full/$publicId/$file", () => {
  async function callGet(
    file: string,
    query = "",
    publicId = PUBLIC_ID,
  ): Promise<Response> {
    const { Route } = await import("#/routes/api/album-full.$publicId.$file");
    const handlers = (
      Route.options as unknown as {
        server: {
          handlers: {
            GET: (ctx: {
              params: { publicId: string; file: string };
              request: Request;
            }) => Promise<Response>;
          };
        };
      }
    ).server.handlers;
    return handlers.GET({
      params: { publicId, file },
      request: new Request(
        `https://x.test/api/album-full/${publicId}/${file}${query}`,
      ),
    });
  }

  it("sends the success headers inline, and an attachment for ?download=1", async () => {
    await seedPhoto({});
    await signInAsMember();
    const inline = await callGet(FILE);
    expect(inline.status).toBe(200);
    expect(Object.fromEntries(inline.headers)).toMatchObject({
      "content-type": "image/webp",
      "content-length": "3",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    });
    expect(Array.from(new Uint8Array(await inline.arrayBuffer()))).toEqual([
      9, 9, 9,
    ]);

    const download = await callGet(FILE, "?download=1");
    expect(download.headers.get("content-disposition")).toBe(
      `attachment; filename="ucmc-${PUBLIC_ID}.webp"`,
    );
    await download.arrayBuffer();
  });

  it("answers every refusal with one identical 404", async () => {
    await seedPhoto({});
    await signInAsMember();
    const cases: Array<() => Promise<Response>> = [
      () => callGet("ffffffffffffffff.webp"),
      () => callGet("not-a-hash.webp"),
      () => callGet(FILE, "", "nope00000000"),
      async () => {
        await getDb().insert(schema.albumPhotos).values({
          id: "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6c",
          publicId: "legacy123456",
          altText: "alt",
          imageKey: "gallery/l/l.webp",
          imageBytes: 1,
          widthPx: 1600,
          heightPx: 1200,
        });
        return callGet(FILE, "", "legacy123456");
      },
      async () => {
        const grant = {
          roleId: "role_member",
          permissionId: "perm_public_album_view_original",
        };
        await getDb()
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, grant.roleId),
              eq(schema.rolePermissions.permissionId, grant.permissionId),
            ),
          );
        try {
          return await callGet(FILE);
        } finally {
          await getDb().insert(schema.rolePermissions).values(grant);
        }
      },
      async () => {
        await getPrivateBucket().delete(FULL_KEY);
        return callGet(FILE);
      },
      async () => {
        await getPrivateBucket().put(FULL_KEY, STORED_FULL);
        await getDb()
          .update(schema.albumPhotos)
          .set({ fullKey: null })
          .where(eq(schema.albumPhotos.id, PHOTO_ID));
        await getPrivateBucket().delete(FULL_KEY);
        mocks.output.mockRejectedValue(new Error("9422"));
        return callGet(FILE);
      },
      async () => {
        cookieJar.clear();
        return callGet(FILE);
      },
    ];
    const seen: Array<{
      status: number;
      headers: [string, string][];
      body: string;
    }> = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const run of cases) {
      const res = await run();
      seen.push({
        status: res.status,
        headers: [...res.headers].sort(),
        body: await res.text(),
      });
    }
    spy.mockRestore();
    expect(seen).toHaveLength(cases.length);
    expect(seen[0]).toEqual({
      status: 404,
      headers: [
        ["cache-control", "private, no-store"],
        ["content-type", "text/plain;charset=UTF-8"],
      ],
      body: "Not found",
    });
    for (const other of seen) {
      expect(other).toEqual(seen[0]);
    }
  });
});
