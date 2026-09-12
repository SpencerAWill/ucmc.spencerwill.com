import { describe, expect, it } from "vitest";

import {
  outingJoinHref,
  requestVolunteersHref,
} from "#/features/volunteer/lib/join-link";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

function outing(
  overrides: Partial<VolunteerEventEntry> = {},
): VolunteerEventEntry {
  return {
    id: "vevt_1",
    publicId: "abcdefghijkl",
    title: "Trail day",
    partnerOrg: null,
    location: null,
    startsAtMs: 0,
    endsAtMs: null,
    description: null,
    signupUrl: null,
    volunteersCount: null,
    serviceHours: null,
    albumTag: null,
    ...overrides,
  };
}

describe("outingJoinHref", () => {
  it("prefers the partner's own registration form", () => {
    const result = outingJoinHref(
      outing({ signupUrl: "https://partner.org/register" }),
      "club@example.com",
    );
    expect(result).toEqual({
      href: "https://partner.org/register",
      external: true,
    });
  });

  it("falls back to a mail draft naming the outing", () => {
    const result = outingJoinHref(outing(), "club@example.com");
    expect(result?.external).toBe(false);
    expect(result?.href).toBe(
      "mailto:club@example.com?subject=Volunteer%20sign-up%3A%20Trail%20day",
    );
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ])("refuses to render %s as an href", (hostile) => {
    // zod's `.url()` accepts every one of these, so the render-time
    // check is what actually protects the page — and it must hold for
    // rows written before the schema's allowlist shipped.
    const result = outingJoinHref(
      outing({ signupUrl: hostile }),
      "club@example.com",
    );
    expect(result?.href).not.toContain("script");
    expect(result?.external).toBe(false);
    expect(result?.href.startsWith("mailto:")).toBe(true);
  });

  it("still refuses when there is no club email to fall back to", () => {
    expect(
      outingJoinHref(outing({ signupUrl: "javascript:alert(1)" }), null),
    ).toBeNull();
  });

  it("returns nothing when there is no link and no club email", () => {
    // Rendering an href="" would resolve as a same-origin reload, which
    // is worse than offering no button at all.
    expect(outingJoinHref(outing(), null)).toBeNull();
    expect(outingJoinHref(outing(), "")).toBeNull();
  });
});

describe("requestVolunteersHref", () => {
  it("pre-loads the questions an officer would have to ask anyway", () => {
    const href = requestVolunteersHref("club@example.com");
    expect(href).toContain("mailto:club@example.com");
    expect(decodeURIComponent(href ?? "")).toContain("How many volunteers:");
  });

  it("returns nothing on a blank club email", () => {
    expect(requestVolunteersHref(null)).toBeNull();
    expect(requestVolunteersHref("")).toBeNull();
  });
});
