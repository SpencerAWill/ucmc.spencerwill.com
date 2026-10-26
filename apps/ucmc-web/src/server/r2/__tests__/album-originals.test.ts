import { describe, expect, it } from "vitest";

import {
  albumFullKey,
  albumOriginalKey,
  deleteAlbumPrivate,
  getAlbumPrivate,
  headAlbumPrivate,
  parseAlbumFullKey,
  parseAlbumOriginalKey,
  putAlbumFull,
  putAlbumOriginal,
} from "#/server/r2/album-originals.server";

const ID = "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6b";
const HASH = "0123456789abcdef";

describe("album original keys", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ] as const)("round-trips an original of type %s", (contentType, ext) => {
    const key = albumOriginalKey(ID, HASH, contentType);
    expect(key).toBe(`album-originals/${ID}/${HASH}.${ext}`);
    expect(parseAlbumOriginalKey(key)).toEqual({
      photoId: ID,
      hash: HASH,
      contentType,
    });
  });

  it("round-trips a full key", () => {
    const key = albumFullKey(ID, HASH);
    expect(key).toBe(`album-full/${ID}/${HASH}.webp`);
    expect(parseAlbumFullKey(key)).toEqual({ photoId: ID, hash: HASH });
  });

  it.each([
    ["another prefix", `gallery/${ID}/${HASH}.jpg`],
    ["a traversal", `album-originals/../${ID}/${HASH}.jpg`],
    ["uppercase hex", `album-originals/${ID}/0123456789ABCDEF.jpg`],
    ["a 15-character hash", `album-originals/${ID}/0123456789abcde.jpg`],
    ["a non-uuid id", `album-originals/not-a-uuid/${HASH}.jpg`],
    ["a .gif extension", `album-originals/${ID}/${HASH}.gif`],
  ])("parseAlbumOriginalKey rejects %s", (_name, key) => {
    expect(parseAlbumOriginalKey(key)).toBeNull();
  });

  it.each([
    ["another prefix", `album-originals/${ID}/${HASH}.webp`],
    ["a traversal", `album-full/../${ID}/${HASH}.webp`],
    ["uppercase hex", `album-full/${ID}/0123456789ABCDEF.webp`],
    ["a 15-character hash", `album-full/${ID}/0123456789abcde.webp`],
    ["a non-uuid id", `album-full/not-a-uuid/${HASH}.webp`],
    ["a .jpg extension", `album-full/${ID}/${HASH}.jpg`],
  ])("parseAlbumFullKey rejects %s", (_name, key) => {
    expect(parseAlbumFullKey(key)).toBeNull();
  });
});

describe("putAlbumFull", () => {
  it("stores image/webp with the dimensions as custom metadata", async () => {
    const key = albumFullKey(ID, HASH);
    await putAlbumFull(key, new Uint8Array([1, 2, 3]).buffer, {
      widthPx: 4000,
      heightPx: 3000,
    });
    const head = await headAlbumPrivate(key);
    expect(head?.httpMetadata?.contentType).toBe("image/webp");
    expect(head?.customMetadata).toEqual({
      widthPx: "4000",
      heightPx: "3000",
    });
  });
});

describe("putAlbumOriginal", () => {
  it("stores the declared contentType", async () => {
    const key = albumOriginalKey(ID, HASH, "image/png");
    await putAlbumOriginal(key, new Uint8Array([9]).buffer, "image/png");
    const head = await headAlbumPrivate(key);
    expect(head?.httpMetadata?.contentType).toBe("image/png");
  });
});

describe("getAlbumPrivate", () => {
  it("returns the stored bytes", async () => {
    const key = albumFullKey(ID, HASH);
    await putAlbumFull(key, new Uint8Array([4, 5, 6]).buffer, {
      widthPx: 1,
      heightPx: 1,
    });
    const body = await getAlbumPrivate(key);
    expect(new Uint8Array(await body!.arrayBuffer())).toEqual(
      new Uint8Array([4, 5, 6]),
    );
  });

  it("returns null for a missing key", async () => {
    expect(
      await getAlbumPrivate(albumFullKey(ID, "ffffffffffffffff")),
    ).toBeNull();
  });
});

describe("deleteAlbumPrivate", () => {
  it("removes every key and resolves for an empty list", async () => {
    const a = albumOriginalKey(ID, "aaaaaaaaaaaaaaaa", "image/jpeg");
    const b = albumFullKey(ID, "aaaaaaaaaaaaaaaa");
    await putAlbumOriginal(a, new Uint8Array([1]).buffer, "image/jpeg");
    await putAlbumFull(b, new Uint8Array([2]).buffer, {
      widthPx: 1,
      heightPx: 1,
    });
    await deleteAlbumPrivate([a, b]);
    expect(await headAlbumPrivate(a)).toBeNull();
    expect(await headAlbumPrivate(b)).toBeNull();
    await expect(deleteAlbumPrivate([])).resolves.toBeUndefined();
  });
});
