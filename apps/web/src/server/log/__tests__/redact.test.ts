import { describe, expect, it } from "vitest";

import {
  redactEmail,
  redactString,
  redactUrl,
} from "#/server/log/redact.server";

describe("redactEmail", () => {
  it("masks the local part, keeps the domain", () => {
    expect(redactEmail("alice@example.com")).toBe("a***@example.com");
    expect(redactEmail("bob.smith@uc.edu")).toBe("b***@uc.edu");
  });

  it("handles single-character local parts", () => {
    expect(redactEmail("a@example.com")).toBe("*@example.com");
  });

  it("returns a placeholder for empty / null / undefined", () => {
    expect(redactEmail("")).toBe("<empty>");
    expect(redactEmail(null)).toBe("<empty>");
    expect(redactEmail(undefined)).toBe("<empty>");
  });

  it("returns a placeholder for malformed input", () => {
    // No @, leading @, trailing @, double @, missing TLD, missing
    // domain — none of these should leak any substring of the
    // raw value.
    expect(redactEmail("not-an-email")).toBe("<malformed>");
    expect(redactEmail("@example.com")).toBe("<malformed>");
    expect(redactEmail("a@")).toBe("<malformed>");
    expect(redactEmail("foo@@bar.com")).toBe("<malformed>");
    expect(redactEmail("alice@example")).toBe("<malformed>");
    expect(redactEmail("alice@.com")).toBe("<malformed>");
    expect(redactEmail("alice@example.")).toBe("<malformed>");
  });
});

describe("redactUrl", () => {
  it("strips query string and fragment, keeps origin + path", () => {
    expect(
      redactUrl("https://app.example.com/auth/callback?token=secret123"),
    ).toBe("https://app.example.com/auth/callback");
    expect(redactUrl("https://app.example.com/page#section")).toBe(
      "https://app.example.com/page",
    );
  });

  it("preserves the path", () => {
    expect(redactUrl("https://app.example.com/members/u_abc/profile")).toBe(
      "https://app.example.com/members/u_abc/profile",
    );
  });

  it("returns placeholders for empty / malformed", () => {
    expect(redactUrl("")).toBe("<empty>");
    expect(redactUrl(null)).toBe("<empty>");
    expect(redactUrl("not a url")).toBe("<malformed>");
  });
});

describe("redactString", () => {
  it("strips URLs from freeform text", () => {
    expect(
      redactString(
        "Click https://app.example.com/auth/callback?token=abc to sign in",
      ),
    ).toBe("Click <url-redacted> to sign in");
  });

  // URL terminator handling — the previous greedy `[^\s]+` pattern
  // would consume across JSON quotes and object delimiters,
  // erasing most of an error body. The tightened pattern stops at
  // characters that are almost always URL terminators in the
  // contexts we redact.
  it("stops the URL match at JSON / common-string terminators", () => {
    expect(
      redactString(
        '{"help":"https://docs.example/page","message":"bad recipient"}',
      ),
    ).toBe('{"help":"<url-redacted>","message":"bad recipient"}');
  });

  it("doesn't consume trailing punctuation that's not part of the URL", () => {
    expect(redactString("See https://example.com/x, then retry.")).toBe(
      "See <url-redacted>, then retry.",
    );
    expect(redactString("(see https://example.com/x)")).toBe(
      "(see <url-redacted>)",
    );
  });

  it("strips email-shaped substrings from freeform text", () => {
    expect(
      redactString("Validation error: 'to' field invalid: alice@example.com"),
    ).toBe("Validation error: 'to' field invalid: <email-redacted>");
  });

  it("strips both URLs and emails when both are present", () => {
    expect(
      redactString(
        "Failed to send to alice@example.com via https://api.example/send?key=x",
      ),
    ).toBe("Failed to send to <email-redacted> via <url-redacted>");
  });

  it("returns text unchanged when nothing matches", () => {
    expect(redactString("Database connection timed out after 5s")).toBe(
      "Database connection timed out after 5s",
    );
  });
});
