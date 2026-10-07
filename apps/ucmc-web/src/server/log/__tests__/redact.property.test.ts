import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  redactEmail,
  redactString,
  redactUrl,
} from "#/server/log/redact.server";

/**
 * Property-based tests for log redaction.
 *
 * The claim these helpers make is universally quantified — "no input
 * leaks a secret-shaped value into Workers Logs" — and an example-based
 * test can only ever check the inputs someone already thought of, which
 * is the same set they already handled. The interesting failures are the
 * inputs nobody imagined: an address with `+` tagging, a token in a
 * fragment rather than a query, a URL with no path.
 *
 * Workers Logs captures every invocation at `head_sampling_rate: 1` and
 * is visible to anyone with Cloudflare dashboard access, so a leak here
 * is a real disclosure with a ~7-day retention window, not a cosmetic
 * one.
 */

/** Addresses the strict validator accepts, including awkward-but-legal shapes. */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9._%+-]{1,20}$/),
    fc.stringMatching(/^[A-Za-z0-9-]{1,15}$/),
    fc.constantFrom("com", "edu", "org", "co.uk"),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Opaque secret-shaped values — the thing that must never survive. */
const tokenArb = fc.stringMatching(/^[A-Za-z0-9_-]{16,40}$/);

describe("redactEmail", () => {
  it("reveals exactly one character of the local part", () => {
    fc.assert(
      fc.property(emailArb, (email) => {
        const at = email.indexOf("@");
        const local = email.slice(0, at);
        const domain = email.slice(at);
        const out = redactEmail(email);

        // Anti-vacuity guard. `redactEmail` answers `<malformed>` for
        // anything failing its strict pattern, and a generator that
        // drifted into producing those would make every assertion here
        // trivially true while testing nothing.
        expect(
          out,
          `generator produced an address the validator rejects: ${email}`,
        ).not.toBe("<malformed>");

        expect(out).toBe(
          local.length <= 1 ? `*${domain}` : `${local[0]}***${domain}`,
        );
      }),
    );
  });

  it("maps every address sharing a first character and domain to one output", () => {
    // This is the claim, stated as indistinguishability rather than as a
    // substring check — and getting here took two wrong formulations
    // that fast-check shrank to minimal counterexamples.
    //
    //   `expect(out).not.toContain(local)` failed on `.e@0.edu`: the
    //   local part `.e` also occurs inside the preserved domain.
    //   Scoping it to the output's local part failed on `--@-.com`: the
    //   first character is revealed by design, so when the local part
    //   repeats it, the "hidden" tail is a substring of what's allowed
    //   to show.
    //
    // Neither was a bug in the code. "Only the first character
    // survives" is a statement about what an operator can DISTINGUISH,
    // so two addresses that agree on that character must be
    // indistinguishable in the log.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9._%+-]{1,20}$/),
        fc.stringMatching(/^[A-Za-z0-9._%+-]{1,20}$/),
        fc.stringMatching(/^[A-Za-z0-9-]{1,15}$/),
        (localA, localB, domain) => {
          // Force the shared first character; everything after it is
          // what must not survive.
          const a = `x${localA}@${domain}.edu`;
          const b = `x${localB}@${domain}.edu`;

          expect(redactEmail(a)).toBe(redactEmail(b));
        },
      ),
    );
  });

  it("preserves the domain, so populations stay distinguishable", () => {
    fc.assert(
      fc.property(emailArb, (email) => {
        expect(redactEmail(email)).toContain(email.slice(email.indexOf("@")));
      }),
    );
  });

  it("returns a placeholder rather than echoing anything malformed", () => {
    // The dangerous branch. If a value fails the strict pattern, the
    // helper must not pass it through — "it didn't look like an email"
    // is exactly when it might be something worse.
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (input) => {
        const out = redactEmail(input);
        if (out === "<empty>" || out === "<malformed>") {
          return;
        }
        // Anything else must be a redaction of a genuinely valid address.
        expect(out).toMatch(/^.?\*+@/);
      }),
    );
  });
});

describe("redactUrl", () => {
  it("never lets a query string or fragment survive", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("http", "https"),
        fc.stringMatching(/^[a-z]{2,10}\.[a-z]{2,4}$/),
        fc.stringMatching(/^[a-z0-9/-]{0,30}$/),
        tokenArb,
        (scheme, host, path, token) => {
          const url = `${scheme}://${host}/${path}?token=${token}#frag-${token}`;
          const out = redactUrl(url);

          // Magic-link tokens live in the query string, which is the
          // reason this helper exists at all.
          expect(out).not.toContain(token);
          expect(out).not.toContain("?");
          expect(out).not.toContain("#");
          expect(out).toContain(host);
        },
      ),
    );
  });

  it("never throws, whatever it is handed", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (input) => {
        expect(() => redactUrl(input)).not.toThrow();
      }),
    );
  });
});

describe("redactString", () => {
  it("removes an embedded address from surrounding freeform text", () => {
    fc.assert(
      fc.property(
        // Prose that cannot itself contain an address or a URL, so a
        // surviving match is unambiguously the one we planted.
        fc.stringMatching(/^[a-z ]{0,40}$/),
        emailArb,
        fc.stringMatching(/^[a-z ]{0,40}$/),
        (before, email, after) => {
          const out = redactString(`${before}${email}${after}`);
          expect(out).not.toContain(email);
          expect(out).toContain("<email-redacted>");
        },
      ),
    );
  });

  it("removes an embedded token-bearing URL", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z ]{0,40}$/),
        fc.stringMatching(/^[a-z]{2,10}\.[a-z]{2,4}$/),
        tokenArb,
        (prose, host, token) => {
          const out = redactString(
            `${prose}https://${host}/auth/callback?token=${token}`,
          );
          expect(
            out,
            "a magic-link token survived redaction inside freeform text",
          ).not.toContain(token);
        },
      ),
    );
  });

  it("never throws, whatever it is handed", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (input) => {
        expect(() => redactString(input)).not.toThrow();
      }),
    );
  });
});
