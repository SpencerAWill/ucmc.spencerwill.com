import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_RETURN_PATH_LENGTH, safeReturnPath } from "#/lib/safe-return-path";

/**
 * Property-based tests for the post-sign-in return-path check.
 *
 * The claim is universally quantified — "no accepted value leaves the
 * site" — so it's tested as the invariant itself: resolve every accepted
 * value against our origin with the same WHATWG parser a browser uses,
 * and require that the origin didn't change. A fixture list of `//x` and
 * `javascript:` would only restate the cases the helper already names.
 */
const ORIGIN = "https://ucmc.example";

/** Strings biased toward the shapes that have broken redirect checks:
 *  leading slashes and backslashes, whitespace and control characters,
 *  schemes, and `@`/`:` that a parser might read as userinfo or port. */
const hostile = fc
  .array(
    fc.oneof(
      fc.constantFrom(
        "/",
        "\\",
        "//",
        "/\\",
        "\t",
        "\n",
        "\r",
        " ",
        "\u0000",
        "\u007f",
        "%2f",
        "%5c",
        "@",
        ":",
        ".",
        "..",
        "?",
        "#",
        "javascript:",
        "https:",
        "evil.example",
      ),
      fc.string({ unit: "binary", maxLength: 4 }),
    ),
    { maxLength: 8 },
  )
  .map((parts) => parts.join(""));

describe("safeReturnPath", () => {
  it("never accepts a value that resolves off-origin", () => {
    // Anti-vacuity: a helper that rejected everything would pass the
    // origin check trivially, so count what got through and require
    // that the generator actually reached the accepting branch.
    const accepted: string[] = [];
    fc.assert(
      fc.property(fc.oneof(hostile, fc.string({ unit: "binary" })), (input) => {
        const out = safeReturnPath(input);
        if (out === null) {
          return true;
        }
        accepted.push(out);
        // A `false` return fails the property and prints the shrunk input.
        return new URL(out, ORIGIN).origin === ORIGIN;
      }),
      { numRuns: 2000 },
    );
    expect(accepted.length).toBeGreaterThan(0);
  });

  it("returns an accepted value unchanged", () => {
    fc.assert(
      fc.property(fc.oneof(hostile, fc.string()), (input) => {
        const out = safeReturnPath(input);
        expect(out === null || out === input).toBe(true);
      }),
    );
  });

  it("accepts any ordinary path with a search string", () => {
    // The direction that matters for usability: a real guarded page,
    // with its search params, must survive. Segments are URL-safe
    // characters, so nothing here is suspicious.
    const segment = fc.stringMatching(/^[A-Za-z0-9._~-]{1,12}$/);
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 5 }),
        fc.option(fc.stringMatching(/^[A-Za-z0-9=&_-]{0,20}$/)),
        (segments, search) => {
          const path = `/${segments.join("/")}${search === null ? "" : `?${search}`}`;
          expect(safeReturnPath(path)).toBe(path);
        },
      ),
    );
  });

  it.each([
    ["protocol-relative", "//evil.example/x"],
    ["backslash protocol-relative", "/\\evil.example"],
    ["tab smuggled between slashes", "/\t/evil.example"],
    ["absolute https URL", "https://evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["no leading slash", "members"],
    ["empty", ""],
    ["over-long", `/${"a".repeat(MAX_RETURN_PATH_LENGTH)}`],
  ])("rejects %s", (_label, input) => {
    expect(safeReturnPath(input)).toBeNull();
  });

  it("accepts a path exactly at the length cap", () => {
    const atCap = `/${"a".repeat(MAX_RETURN_PATH_LENGTH - 1)}`;
    expect(safeReturnPath(atCap)).toBe(atCap);
  });

  it("rejects non-strings", () => {
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
  });
});
