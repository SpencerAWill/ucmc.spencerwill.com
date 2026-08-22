import { describe, expect, it, vi } from "vitest";

/**
 * Guards the agreement between the three places that touch an album
 * photo's R2 object key:
 *
 *   1. `albumImageKey()` mints it   (`#/server/r2/album-images.server`)
 *   2. `albumImageUrl()` strips the prefix off for the local-dev URL
 *   3. `routes/api/album-image.$.ts` prepends it back to read from R2
 *
 * (3) can't be imported here without instantiating a file route, so it
 * consumes `ALBUM_R2_PREFIX` from (2) rather than spelling the prefix
 * out — the two held separate literals during the Trip Gallery → Album
 * rename, the rename updated one of them, and local dev started 404ing
 * every photo. These assertions fail loudly if they diverge again.
 */

const stubEnv: { VITE_R2_PUBLIC_HOST: string | undefined } = {
  VITE_R2_PUBLIC_HOST: undefined,
};
vi.mock("#/config/env", () => ({ env: stubEnv }));

const { albumImageUrl, ALBUM_R2_PREFIX } =
  await import("#/features/album/lib/image-url");
const { albumImageKey } = await import("#/server/r2/album-images.server");

// Shapes produced in production: `uuidv7()` for the id, and
// `shortContentHash()` — 16 lowercase hex chars — for the hash.
const ID = "0198c2f4-6b7a-7000-8a1b-2c3d4e5f6071";
const HASH = "a1b2c3d4e5f60718";

describe("album photo R2 keys", () => {
  it("mints keys under the prefix the URL builder strips", () => {
    const key = albumImageKey(ID, HASH);
    expect(key.startsWith(ALBUM_R2_PREFIX)).toBe(true);
  });

  it("round-trips key → dev URL → key", () => {
    // This is the invariant the route relies on: re-prepending
    // ALBUM_R2_PREFIX to the URL's splat has to reproduce the original
    // object key exactly, or the R2 `get` misses.
    const key = albumImageKey(ID, HASH);
    const url = albumImageUrl(key);
    const splat = url.replace("/api/album-image/", "");
    expect(`${ALBUM_R2_PREFIX}${splat}`).toBe(key);
  });

  it("emits a splat the serving route's pattern accepts", () => {
    // Kept in sync with SPLAT_PATTERN in
    // `src/routes/api/album-image.$.ts`, which can't be imported here
    // without instantiating the route. If the key layout changes, this
    // fails and points at the route to update.
    const splat = albumImageUrl(albumImageKey(ID, HASH)).replace(
      "/api/album-image/",
      "",
    );
    expect(splat).toMatch(/^[0-9a-z-]+\/[a-f0-9]{16}\.webp$/);
  });

  it("serves straight off the CDN when a public host is configured", () => {
    // Deployed envs never hit the worker route, so the full key —
    // historical prefix included — is what appears in the URL.
    stubEnv.VITE_R2_PUBLIC_HOST = "cdn.ucmc.spencerwill.com";
    try {
      expect(albumImageUrl(albumImageKey(ID, HASH))).toBe(
        `https://cdn.ucmc.spencerwill.com/${ALBUM_R2_PREFIX}${ID}/${HASH}.webp`,
      );
    } finally {
      stubEnv.VITE_R2_PUBLIC_HOST = undefined;
    }
  });
});
