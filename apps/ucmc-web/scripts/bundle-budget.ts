/**
 * The bundle-size budget `pnpm --filter ucmc-web size` enforces (#190).
 *
 * Every number is gzip, measured by `check-bundle-size.ts` after
 * `vite build`. Client figures are kB (1,000 bytes), the unit Vite's build
 * log uses; the Worker figure is KiB, the unit Wrangler's "Total Upload" line
 * uses. Each was set from `main` plus 10% headroom on 2026-10-30, so the
 * first run was green and a failure since then is a real regression.
 *
 * Raising a number is allowed, and is the point: it puts the growth in the PR
 * diff, where it has to be justified. Say what grew and why in the commit.
 */
import type { ClientBudget } from "./bundle-size";

export const CLIENT_BUDGET: ClientBudget = {
  // The client entry plus every chunk it statically imports: what a first
  // page load downloads before any route chunk. Baseline 417.3 kB.
  initialGzipKb: 459,

  // The entry chunk alone (React, the router, the app shell). Baseline
  // 285.1 kB.
  entryGzipKb: 314,

  // Any other chunk, lazy or shared, that isn't exempted below. Baseline
  // 45.4 kB (`markdown-content`). Kept tight on purpose: a heavy new
  // dependency on one route should fail here and be split or exempted
  // deliberately, not ride in under the entry's much larger cap.
  chunkGzipKb: 50,

  // Chunks allowed past `chunkGzipKb`, by Rollup chunk name. An exempt chunk
  // must stay lazy: the check fails if one lands in the initial set, and
  // also if a name here matches no chunk, or more than one.
  lazyExemptions: [
    // Tiptap, ~185 kB. Only ships on routes that mount the editor.
    "markdown-editor",
  ],
};

// Cloudflare's limit is 64 MiB uncompressed and there is no compressed
// limit (`docs/platform-limits.md`). This is a proxy for the 1 s startup
// limit instead: global scope has to finish within it (error 10021), and
// bundle size is what grows it. Baseline 2,300 KiB; 2,560 is flareling's
// default for the same check.
export const WORKER_GZIP_BUDGET_KIB = 2560;
