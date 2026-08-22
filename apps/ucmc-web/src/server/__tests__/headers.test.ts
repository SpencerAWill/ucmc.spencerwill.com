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

  it("relaxes frame-ancestors + X-Frame-Options on the gazette PDF route", () => {
    // The inline PDF viewer on /gazette/$publicId iframes
    // /api/gazette-pdf/<key>; the global CSP sets
    // `frame-ancestors 'none'` + `X-Frame-Options: DENY` so without
    // this path-scoped relaxation the iframe would be blank.
    const headers = Object.fromEntries(
      securityHeadersForPath("/api/gazette-pdf/abc/xyz.pdf"),
    );
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'self'",
    );
    expect(headers["Content-Security-Policy"]).not.toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    // nosniff + HSTS still ship on the embeddable response.
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=/);
  });

  it("allows blob: for img-src and worker-src (image cropper)", () => {
    // The in-app image cropper (landing editors + /album) renders the
    // working photo via `URL.createObjectURL(blob)` and spins up the
    // compression worker from a blob URL. Both need explicit `blob:`
    // allowance in CSP — `worker-src` would otherwise inherit from
    // `script-src`, which deliberately omits `blob:`.
    const csp = securityHeadersForPath("/").find(
      ([n]) => n === "Content-Security-Policy",
    )?.[1];
    expect(csp).toMatch(/img-src [^;]*\bblob:/);
    expect(csp).toMatch(/worker-src [^;]*\bblob:/);
  });
});
