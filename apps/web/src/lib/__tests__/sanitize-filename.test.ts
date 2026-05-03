import { describe, expect, it } from "vitest";

import { sanitizeFilenameSegment } from "#/lib/sanitize-filename";

describe("sanitizeFilenameSegment", () => {
  it("passes through plain alphanumerics, dot, underscore, dash", () => {
    expect(sanitizeFilenameSegment("alice.example_1-2")).toBe(
      "alice.example_1-2",
    );
  });

  it("replaces an `@` with `_` so plain emails round-trip readably", () => {
    expect(sanitizeFilenameSegment("alice@example.com")).toBe(
      "alice_example.com",
    );
  });

  it("strips characters that would break Content-Disposition", () => {
    // ; = " \r \n — the separators that matter for header injection.
    expect(sanitizeFilenameSegment('a;filename="evil"')).toBe(
      "a_filename__evil_",
    );
    expect(sanitizeFilenameSegment("a\r\nb")).toBe("a__b");
    expect(sanitizeFilenameSegment("a=b;c=d")).toBe("a_b_c_d");
  });

  it("strips path separators", () => {
    expect(sanitizeFilenameSegment("a/b\\c")).toBe("a_b_c");
    // `.` is allowed in filenames, so `..` survives — that's fine
    // here because the segment is interpolated into a
    // Content-Disposition header, not a filesystem path. Only `/` and
    // `\` would be header-injection concerns or browser-side
    // confusion, and both are stripped.
    expect(sanitizeFilenameSegment("../../etc/passwd")).toBe(
      ".._.._etc_passwd",
    );
  });

  it("collapses unicode and control characters", () => {
    expect(sanitizeFilenameSegment("héllo")).toBe("h_llo");
    expect(sanitizeFilenameSegment("a\x00b")).toBe("a_b");
    expect(sanitizeFilenameSegment("a\tb")).toBe("a_b");
  });

  it("returns an empty string unchanged", () => {
    expect(sanitizeFilenameSegment("")).toBe("");
  });
});
