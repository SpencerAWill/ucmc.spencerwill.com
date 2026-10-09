import { describe, expect, it } from "vitest";

import { CART_TOKEN_PREFIX } from "#/features/gear/lib/cart-token";
import {
  isForeignSymbology,
  parseScanPayload,
} from "#/features/gear/lib/scan-payload";

const TOKEN = `${CART_TOKEN_PREFIX}2f1d8c3a-9b40-4e21-8a77-5c6e1f0b4d92`;

describe("parseScanPayload", () => {
  it("reads a bare gear code", () => {
    expect(parseScanPayload("CH93")).toEqual({
      kind: "code",
      code: "CH93",
      symbology: null,
    });
  });

  it("reads a cart token by its prefix", () => {
    expect(parseScanPayload(TOKEN)).toEqual({
      kind: "cart",
      token: TOKEN,
      symbology: null,
    });
  });

  it("accepts a three-character code", () => {
    // `LJ4` is a real shape. Any minimum-length rule that rejected it
    // would reject a meaningful slice of the cave's labels.
    expect(parseScanPayload("LJ4")).toEqual({
      kind: "code",
      code: "LJ4",
      symbology: null,
    });
  });

  // ── AIM symbology identifiers (ISO/IEC 15424) ─────────────────────

  it("strips `]C0` — what our CODE128 labels actually transmit", () => {
    expect(parseScanPayload("]C0CH93")).toEqual({
      kind: "code",
      code: "CH93",
      symbology: "C0",
    });
  });

  it("strips `]C1` too, though we never emit GS1-128", () => {
    // Pinning the shape match rather than a literal: a discriminator
    // hardcoded to `]C1` (the identifier most documentation leads with)
    // would have failed on every real scan, since plain CODE128 is
    // `]C0`.
    expect(parseScanPayload("]C1CH93")).toEqual({
      kind: "code",
      code: "CH93",
      symbology: "C1",
    });
  });

  it("strips a QR identifier off a cart token", () => {
    expect(parseScanPayload(`]Q1${TOKEN}`)).toEqual({
      kind: "cart",
      token: TOKEN,
      symbology: "Q1",
    });
  });

  it("accepts a hex modifier, which option values above nine produce", () => {
    expect(parseScanPayload("]cA1234")).toMatchObject({ symbology: "cA" });
  });

  it("keeps a `]` that isn't a well-formed identifier as part of the code", () => {
    // `]` followed by anything but letter+hex-digit is not an AIM ID,
    // and swallowing it would corrupt a code that legitimately starts
    // with a bracket.
    expect(parseScanPayload("]99CH93")).toEqual({
      kind: "code",
      code: "]99CH93",
      symbology: null,
    });
  });

  // ── rejections ────────────────────────────────────────────────────

  it("trims the trailing CR some wedges send with the Enter", () => {
    expect(parseScanPayload("CH93\r")).toMatchObject({ code: "CH93" });
  });

  it("refuses an empty or whitespace-only payload", () => {
    expect(parseScanPayload("")).toBeNull();
    expect(parseScanPayload("   ")).toBeNull();
    expect(parseScanPayload("]C0")).toBeNull();
  });

  it("refuses a payload with interior whitespace", () => {
    expect(parseScanPayload("CH 93")).toBeNull();
  });

  it("refuses a runaway payload", () => {
    expect(parseScanPayload("X".repeat(65))).toBeNull();
    expect(parseScanPayload("X".repeat(64))).not.toBeNull();
  });

  it("does not length-cap a cart token", () => {
    // The token is 46 characters and matches by prefix before the
    // bare-code cap applies — a cap that caught it would break the QR
    // path the day someone raised the UUID format.
    expect(parseScanPayload(TOKEN)).toMatchObject({ kind: "cart" });
  });
});

describe("isForeignSymbology", () => {
  it("is false when the reader transmitted nothing", () => {
    // An unconfigured gun tells us nothing, which is not evidence of a
    // foreign tag.
    expect(isForeignSymbology(null)).toBe(false);
  });

  it("is false for the symbologies we print", () => {
    expect(isForeignSymbology("C0")).toBe(false);
    expect(isForeignSymbology("Q1")).toBe(false);
  });

  it("is true for a DataMatrix — a manufacturer's PPE mark", () => {
    expect(isForeignSymbology("d1")).toBe(true);
  });
});
