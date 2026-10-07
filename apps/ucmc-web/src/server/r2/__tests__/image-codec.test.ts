import { describe, expect, it } from "vitest";

import {
  decodeImageDataUrl,
  shortContentHash,
} from "#/server/r2/image-codec.server";

/**
 * `decodeImageDataUrl` is the trust boundary for every base64 image
 * upload — avatars, landing hero images, gear photos, sponsor logos.
 * It had no tests.
 *
 * The security-relevant half is `matchesMagic`: the content type is
 * supplied by the *client*, in the data URL it also supplies, and that
 * type is what gets written to R2 and later served back in a
 * `Content-Type` header. Trusting the declaration would let a caller
 * store arbitrary bytes under `image/png` and have the worker serve
 * them back with that type.
 */

// Minimal valid headers. Only the magic prefix is inspected, so a
// realistic-length body isn't needed to exercise the check.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// "RIFF" + 4 size bytes + "WEBP"
const WEBP_MAGIC = [
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];

function dataUrl(contentType: string, bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);
  return `data:${contentType};base64,${btoa(binary)}`;
}

describe("decodeImageDataUrl", () => {
  it.each([
    ["image/png", PNG_MAGIC],
    ["image/jpeg", JPEG_MAGIC],
    ["image/webp", WEBP_MAGIC],
  ])("accepts a well-formed %s", (contentType, magic) => {
    const result = decodeImageDataUrl(dataUrl(contentType, magic), 1024);

    expect(result.contentType).toBe(contentType);
    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array(magic));
  });

  it.each([
    ["image/png", JPEG_MAGIC],
    ["image/jpeg", WEBP_MAGIC],
    ["image/webp", PNG_MAGIC],
  ])(
    "rejects bytes that don't match the declared %s",
    (contentType, wrongMagic) => {
      // The actual defence. The declared type comes from the client and
      // ends up on the stored object and in the response header, so
      // taking its word for it is how you serve attacker-chosen bytes
      // under an image content type.
      expect(() =>
        decodeImageDataUrl(dataUrl(contentType, wrongMagic), 1024),
      ).toThrow(/do not match declared content type/);
    },
  );

  it("rejects a payload whose magic prefix is truncated", () => {
    // Shorter than the prefix the check reads. Pinned because the
    // length guards (`bytes.length >= 12` and friends) are easy to drop
    // during a tidy-up, and without them the comparison reads
    // `undefined === 0x57`, which is false — so this would still be
    // rejected — but the reverse edit, comparing with `!=`, would not.
    expect(() =>
      decodeImageDataUrl(dataUrl("image/webp", WEBP_MAGIC.slice(0, 6)), 1024),
    ).toThrow(/do not match declared content type/);
  });

  it("rejects a content type outside the accepted set", () => {
    // GIF and SVG are the interesting exclusions: SVG is a script
    // delivery vehicle when served inline, so it must not become an
    // accepted type by accident.
    for (const contentType of ["image/gif", "image/svg+xml", "text/html"]) {
      expect(() =>
        decodeImageDataUrl(dataUrl(contentType, PNG_MAGIC), 1024),
      ).toThrow(/not a recognized type/);
    }
  });

  it("rejects anything that isn't a base64 image data URL", () => {
    for (const input of [
      "",
      "https://example.com/cat.png",
      "data:image/png,notbase64",
      "data:image/png;base64,!!!!",
      // A second payload smuggled after the first — the regex is
      // anchored at both ends, which is what stops this.
      `${dataUrl("image/png", PNG_MAGIC)},data:image/png;base64,AAAA`,
    ]) {
      expect(() => decodeImageDataUrl(input, 1024)).toThrow();
    }
  });

  it("enforces the byte ceiling, and reports both numbers", () => {
    const big = [...PNG_MAGIC, ...new Array<number>(200).fill(0)];

    expect(() => decodeImageDataUrl(dataUrl("image/png", big), 64)).toThrow(
      /exceeds 64 bytes \(got 208\)/,
    );
    // The boundary itself is allowed: the guard is `>`, not `>=`.
    expect(() =>
      decodeImageDataUrl(dataUrl("image/png", big), big.length),
    ).not.toThrow();
  });

  it("checks size before validating magic bytes", () => {
    // Ordering matters for a hostile upload: a 30MB payload with a bad
    // header should be refused on size, not after the magic check walks
    // it. Pinned by asserting *which* error a doubly-invalid input
    // raises.
    const oversizedAndWrongType = [
      ...JPEG_MAGIC,
      ...new Array<number>(100).fill(0),
    ];

    expect(() =>
      decodeImageDataUrl(dataUrl("image/png", oversizedAndWrongType), 16),
    ).toThrow(/exceeds 16 bytes/);
  });
});

describe("shortContentHash", () => {
  it("returns 8 bytes as 16 lowercase hex characters", async () => {
    const hash = await shortContentHash(new Uint8Array(PNG_MAGIC).buffer);

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — the same bytes give the same R2 key", async () => {
    // The hash *is* the immutable R2 key, so instability would orphan
    // every previously-written object instead of deduplicating onto it.
    const a = await shortContentHash(new Uint8Array(PNG_MAGIC).buffer);
    const b = await shortContentHash(new Uint8Array(PNG_MAGIC).buffer);

    expect(a).toBe(b);
  });

  it("separates different content", async () => {
    const a = await shortContentHash(new Uint8Array(PNG_MAGIC).buffer);
    const b = await shortContentHash(new Uint8Array(JPEG_MAGIC).buffer);

    expect(a).not.toBe(b);
  });

  it("matches the documented SHA-256 prefix", async () => {
    // Pins the algorithm and the truncation, not just the shape: a
    // switch to SHA-1 or to the LAST 8 bytes would keep every assertion
    // above passing while changing every key the app writes.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(PNG_MAGIC).buffer,
    );
    const expected = Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    expect(await shortContentHash(new Uint8Array(PNG_MAGIC).buffer)).toBe(
      expected,
    );
  });
});
