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

const { uploadAlbumOriginalAction } =
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
