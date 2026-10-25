/**
 * The shared `data:` URL decoder behind avatar and site-feedback
 * screenshot uploads. The declared type is the client's claim; the magic
 * bytes are what the server believes.
 */
import { describe, expect, it } from "vitest";

import { decodeImageDataUrl } from "#/server/r2/image-data-url.server";

function dataUrl(type: string, bytes: number[]): string {
  return `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`;
}

const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1];
const ALL = ["image/webp", "image/jpeg", "image/png"] as const;

describe("decodeImageDataUrl", () => {
  it("decodes webp whose bytes start RIFF....WEBP", () => {
    const out = decodeImageDataUrl(dataUrl("image/webp", WEBP), {
      allowed: ALL,
      maxBytes: 100,
    });
    expect(out.contentType).toBe("image/webp");
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array(WEBP));
  });

  it("decodes jpeg whose bytes start FF D8 FF", () => {
    expect(
      decodeImageDataUrl(dataUrl("image/jpeg", JPEG), {
        allowed: ALL,
        maxBytes: 100,
      }).contentType,
    ).toBe("image/jpeg");
  });

  it("decodes png whose bytes carry the PNG signature", () => {
    expect(
      decodeImageDataUrl(dataUrl("image/png", PNG), {
        allowed: ALL,
        maxBytes: 100,
      }).contentType,
    ).toBe("image/png");
  });

  it.each([
    ["image/webp", JPEG],
    ["image/jpeg", PNG],
    ["image/png", WEBP],
  ])("rejects %s whose bytes are another format", (type, bytes) => {
    expect(() =>
      decodeImageDataUrl(dataUrl(type, bytes), { allowed: ALL, maxBytes: 100 }),
    ).toThrow("do not match");
  });

  it("rejects a type outside allowed even when its bytes are right", () => {
    expect(() =>
      decodeImageDataUrl(dataUrl("image/png", PNG), {
        allowed: ["image/webp", "image/jpeg"],
        maxBytes: 100,
      }),
    ).toThrow("not an allowed image type");
  });

  it("rejects more than maxBytes decoded, and accepts exactly maxBytes", () => {
    const exact = [...JPEG, ...Array<number>(10 - JPEG.length).fill(0)];
    expect(
      decodeImageDataUrl(dataUrl("image/jpeg", exact), {
        allowed: ALL,
        maxBytes: 10,
      }).bytes.byteLength,
    ).toBe(10);
    expect(() =>
      decodeImageDataUrl(dataUrl("image/jpeg", [...exact, 0]), {
        allowed: ALL,
        maxBytes: 10,
      }),
    ).toThrow("exceeds 10 bytes");
  });

  it("rejects something that isn't an image data URL", () => {
    expect(() =>
      decodeImageDataUrl("data:text/html;base64,PGh0bWw+", {
        allowed: ALL,
        maxBytes: 100,
      }),
    ).toThrow("not an allowed image type");
  });
});
