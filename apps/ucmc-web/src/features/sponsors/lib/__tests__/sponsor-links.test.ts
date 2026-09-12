import { describe, expect, it } from "vitest";

import {
  sponsorInquiryHref,
  sponsorWebsiteHref,
} from "#/features/sponsors/lib/sponsor-links";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";

function sponsor(overrides: Partial<SponsorEntry> = {}): SponsorEntry {
  return {
    id: "spon_1",
    publicId: "abc123",
    name: "Roads Rivers and Trails",
    websiteUrl: "https://example.com",
    blurb: "An outfitter that has kitted out UCMC trips for years.",
    logoKey: null,
    logoWidthPx: null,
    logoHeightPx: null,
    ...overrides,
  };
}

describe("sponsorWebsiteHref", () => {
  it("returns http(s) links unchanged", () => {
    expect(sponsorWebsiteHref(sponsor())).toBe("https://example.com");
    expect(
      sponsorWebsiteHref(sponsor({ websiteUrl: "http://example.com" })),
    ).toBe("http://example.com");
  });

  it("returns null when no website is on file", () => {
    // Not `""` — an empty href resolves as a same-origin reload, so the
    // caller has to be able to tell "no link" from "link to nothing".
    expect(sponsorWebsiteHref(sponsor({ websiteUrl: null }))).toBeNull();
  });

  it("refuses a non-http(s) scheme stored before the schema shipped", () => {
    // The write-side allowlist only guards writes made after it landed;
    // a row from a direct `wrangler d1 execute` edit bypasses it
    // entirely. This is the check that actually keeps `javascript:` out
    // of an `<a href>` on a page anonymous visitors can load.
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "  javascript:alert(1)",
    ]) {
      expect(sponsorWebsiteHref(sponsor({ websiteUrl: url }))).toBeNull();
    }
  });
});

describe("sponsorInquiryHref", () => {
  it("builds a mailto with a subject and a pre-filled body", () => {
    const href = sponsorInquiryHref("club@example.com");
    expect(href).not.toBeNull();
    expect(href).toContain("mailto:club@example.com");
    expect(href).toContain("subject=Sponsoring%20UCMC");
    expect(href).toContain("Organization%3A");
  });

  it("returns null on a blank club email so the button is dropped", () => {
    expect(sponsorInquiryHref(null)).toBeNull();
    expect(sponsorInquiryHref(undefined)).toBeNull();
    expect(sponsorInquiryHref("")).toBeNull();
  });
});
