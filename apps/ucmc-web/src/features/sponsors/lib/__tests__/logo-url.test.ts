import { describe, expect, it, vi } from "vitest";

/**
 * Guards the agreement between the three places that touch a sponsor
 * logo's R2 object key:
 *
 *   1. `sponsorLogoKey()` mints it  (`#/server/r2/sponsor-logos.server`)
 *   2. `sponsorLogoUrl()` strips the prefix off for the local-dev URL
 *   3. `routes/api/sponsor-logo.$.ts` prepends it back to read from R2
 *
 * (3) can't be imported here without instantiating a file route, so it
 * consumes `SPONSOR_R2_PREFIX` from (2) rather than spelling the prefix
 * out. The Album's equivalent pair held separate literals, drifted
 * during a rename, and 404'd every photo in local dev — this is the
 * same assertion, written before rather than after.
 */

const stubEnv: { VITE_R2_PUBLIC_HOST: string | undefined } = {
  VITE_R2_PUBLIC_HOST: undefined,
};
vi.mock("#/config/env", () => ({ env: stubEnv }));

const { sponsorLogoUrl, SPONSOR_R2_PREFIX } =
  await import("#/features/sponsors/lib/logo-url");
const { sponsorLogoKey } = await import("#/server/r2/sponsor-logos.server");

// Shapes produced in production: `uuidv7()` for the id and
// `shortContentHash()` — 16 lowercase hex chars — for the hash.
const ID = "0198c2f4-6b7a-7000-8a1b-2c3d4e5f6071";
const HASH = "a1b2c3d4e5f60718";

describe("sponsor logo R2 keys", () => {
  it("mints keys under the prefix the URL builder strips", () => {
    expect(sponsorLogoKey(ID, HASH).startsWith(SPONSOR_R2_PREFIX)).toBe(true);
  });

  it("round-trips key → dev URL → key", () => {
    const key = sponsorLogoKey(ID, HASH);
    const splat = sponsorLogoUrl(key).replace("/api/sponsor-logo/", "");
    expect(`${SPONSOR_R2_PREFIX}${splat}`).toBe(key);
  });

  it("emits a splat the serving route's pattern accepts", () => {
    // Kept in sync with SPLAT_PATTERN in
    // `src/routes/api/sponsor-logo.$.ts`, which can't be imported here
    // without instantiating the route. If the key layout changes this
    // fails and points at the route to update.
    const splat = sponsorLogoUrl(sponsorLogoKey(ID, HASH)).replace(
      "/api/sponsor-logo/",
      "",
    );
    expect(splat).toMatch(/^[0-9a-z-]+\/[a-f0-9]{16}\.webp$/);
  });

  it("serves straight off the CDN when a public host is configured", () => {
    stubEnv.VITE_R2_PUBLIC_HOST = "cdn.ucmc.spencerwill.com";
    try {
      expect(sponsorLogoUrl(sponsorLogoKey(ID, HASH))).toBe(
        `https://cdn.ucmc.spencerwill.com/${SPONSOR_R2_PREFIX}${ID}/${HASH}.webp`,
      );
    } finally {
      stubEnv.VITE_R2_PUBLIC_HOST = undefined;
    }
  });

  it("is the prefix the orphan sweep lists", () => {
    // `GC_PREFIXES` in `#/server/cron/retention.server.ts` must carry
    // this exact string, or a replaced logo's old object is never
    // collected. Asserted as a literal because importing the cron module
    // here would pull in the whole retention graph.
    expect(SPONSOR_R2_PREFIX).toBe("sponsors/");
  });
});
