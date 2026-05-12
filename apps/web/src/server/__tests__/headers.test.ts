import { describe, expect, it } from "vitest";

import { securityHeadersForPath } from "#/server/headers.server";

function permissionsPolicy(pathname: string): string {
  const entries = securityHeadersForPath(pathname);
  const pp = entries.find(([name]) => name === "Permissions-Policy");
  if (!pp) throw new Error("Permissions-Policy header missing");
  return pp[1];
}

describe("securityHeadersForPath / Permissions-Policy", () => {
  it("grants camera=(self) on /gear/loans and its subroutes", () => {
    expect(permissionsPolicy("/gear/loans")).toContain("camera=(self)");
    expect(permissionsPolicy("/gear/loans/abc123")).toContain("camera=(self)");
  });

  it("denies camera on every other route", () => {
    for (const p of [
      "/",
      "/gear",
      "/gear/loan", // close-but-not-quite — shouldn't accidentally match
      "/my/gear",
      "/members",
      "/announcements",
      "/audit",
    ]) {
      expect(permissionsPolicy(p)).toContain("camera=()");
      expect(permissionsPolicy(p)).not.toContain("camera=(self)");
    }
  });

  it("always disables microphone, geolocation, and payment", () => {
    for (const p of ["/gear/loans", "/anywhere", "/"]) {
      const pp = permissionsPolicy(p);
      expect(pp).toContain("microphone=()");
      expect(pp).toContain("geolocation=()");
      expect(pp).toContain("payment=()");
    }
  });

  it("still emits the load-bearing security headers", () => {
    const names = securityHeadersForPath("/").map(([n]) => n);
    expect(names).toContain("Content-Security-Policy");
    expect(names).toContain("Strict-Transport-Security");
    expect(names).toContain("X-Frame-Options");
    expect(names).toContain("Referrer-Policy");
    expect(names).toContain("X-Content-Type-Options");
  });
});
