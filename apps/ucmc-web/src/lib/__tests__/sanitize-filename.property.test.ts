import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { sanitizeFilenameSegment } from "#/lib/sanitize-filename";

/**
 * Property-based tests for the `Content-Disposition` filename whitelist.
 *
 * Example-based tests for a sanitizer can only ever assert the inputs
 * someone thought of, which is the same set of inputs they already
 * handled. The security claim here is universally quantified — "no input
 * produces a header separator" — so it should be tested that way.
 *
 * fast-check shrinks a failure to a minimal counterexample and prints the
 * seed, so a failure reads as "this exact character breaks it", not "one
 * of 100 random strings did".
 */
describe("sanitizeFilenameSegment", () => {
  it("emits only whitelisted characters, for any input at all", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(sanitizeFilenameSegment(input)).toMatch(/^[A-Za-z0-9._-]*$/);
      }),
    );
  });

  it("never emits a character that could break out of the header", () => {
    // The actual defence being claimed. `unit: "binary"` is
    // fast-check v4's spelling for "any code point, including astral
    // planes and lone surrogates" (v3's `fullUnicodeString`). Those are
    // exactly where a regex operating on UTF-16 code units can surprise
    // you, and a hand-written fixture list never reaches them.
    const FORBIDDEN = ['"', ";", "=", "\r", "\n", "\\", "/", ",", " "];

    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (input) => {
        const out = sanitizeFilenameSegment(input);
        for (const char of FORBIDDEN) {
          expect(out).not.toContain(char);
        }
      }),
    );
  });

  it("is idempotent", () => {
    // Sanitising twice must not differ from sanitising once. A sanitizer
    // that isn't idempotent is one whose output isn't in its own accepted
    // set, which means some caller somewhere gets a different answer
    // depending on how many layers it passed through.
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (input) => {
        const once = sanitizeFilenameSegment(input);
        expect(sanitizeFilenameSegment(once)).toBe(once);
      }),
    );
  });

  it("preserves length in UTF-16 code units", () => {
    // Character-for-character replacement, never deletion. Worth pinning
    // because the obvious "harden it" edit — switching `_` for `""` —
    // silently collapses `a;;b` and `a;b` onto the same name, so two
    // different uploads start overwriting each other's download name.
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (input) => {
        expect(sanitizeFilenameSegment(input)).toHaveLength(input.length);
      }),
    );
  });

  it("leaves already-safe segments untouched", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9._-]+$/), (safe) => {
        expect(sanitizeFilenameSegment(safe)).toBe(safe);
      }),
    );
  });
});
