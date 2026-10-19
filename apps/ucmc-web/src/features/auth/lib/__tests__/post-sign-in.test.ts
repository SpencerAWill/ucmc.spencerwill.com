import { describe, expect, it } from "vitest";

import {
  callbackHref,
  postSignInHref,
  signInReturnPath,
} from "#/features/auth/lib/post-sign-in";

const TARGET = "/gear/abc?tab=loans";
const CARRIED = `redirect=${encodeURIComponent(TARGET)}`;

describe("callbackHref", () => {
  // One row per branch of /auth/callback's decision table. The return
  // path must survive every one of them — dropping it in the two
  // registration rows is the bug #303 describes.
  it.each([
    [
      "first-time registrant (proof)",
      { ok: true, mode: "proof", intent: "register" } as const,
      `/register/profile?${CARRIED}`,
    ],
    [
      "session without a profile",
      {
        ok: true,
        mode: "session",
        hasProfile: false,
        status: "pending",
      } as const,
      `/register/profile?${CARRIED}`,
    ],
    [
      "session awaiting approval",
      {
        ok: true,
        mode: "session",
        hasProfile: true,
        status: "pending",
      } as const,
      `/register/pending?${CARRIED}`,
    ],
    [
      "approved session",
      {
        ok: true,
        mode: "session",
        hasProfile: true,
        status: "approved",
      } as const,
      TARGET,
    ],
  ])("%s carries the return path", (_label, result, expected) => {
    expect(callbackHref(result, TARGET)).toBe(expected);
  });

  it.each([
    ["missing", undefined],
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
  ])("drops a %s return path in every branch", (_label, returnTo) => {
    expect(
      callbackHref({ ok: true, mode: "proof", intent: "register" }, returnTo),
    ).toBe("/register/profile");
    expect(
      callbackHref(
        { ok: true, mode: "session", hasProfile: true, status: "pending" },
        returnTo,
      ),
    ).toBe("/register/pending");
    expect(
      callbackHref(
        { ok: true, mode: "session", hasProfile: true, status: "approved" },
        returnTo,
      ),
    ).toBe("/");
  });
});

describe("postSignInHref", () => {
  it("falls back to the caller's home for an approved account", () => {
    expect(
      postSignInHref(
        { hasProfile: true, status: "approved" },
        undefined,
        "/my/profile",
      ),
    ).toBe("/my/profile");
  });

  it("round-trips the return path through the funnel's search string", () => {
    // The funnel pages parse it back out of `?redirect`, so it has to
    // come out exactly as it went in, its own `?` and `&` included.
    const target = "/members?q=ada&tab=pending";
    const href = postSignInHref(
      { hasProfile: true, status: "pending" },
      target,
    );
    expect(
      new URL(href, "https://ucmc.example").searchParams.get("redirect"),
    ).toBe(target);
  });
});

describe("signInReturnPath", () => {
  it("returns the current page, search included", () => {
    expect(signInReturnPath("/calendar", "?month=2026-10")).toBe(
      "/calendar?month=2026-10",
    );
  });

  it.each([
    "/",
    "/sign-in",
    "/auth/callback",
    "/register/pending",
    "/verify-email",
  ])("has nothing to return to from %s", (pathname) => {
    expect(signInReturnPath(pathname, "")).toBeUndefined();
  });
});
