#!/usr/bin/env tsx
/**
 * Build-time sitemap generator. Writes `public/sitemap.xml` so the
 * file ships as a static asset (served directly by
 * `@cloudflare/vite-plugin`'s auto-injected `assets` block, no worker
 * invocation).
 *
 * Wired into `dev` + `build` in `apps/web/package.json` rather than as
 * a `prebuild` lifecycle hook because pnpm v10 disables those by
 * default. The output is gitignored (single source of truth: this
 * script); CI regenerates on every deploy, so the `lastmod` date in
 * the published file matches the deploy date.
 *
 * `SITE_ORIGIN` is hardcoded to the prod URL on purpose. Sitemaps
 * point at the canonical surface — dev's sitemap (if a crawler ever
 * fetched it, which `robots.txt` should prevent) would still emit
 * prod URLs because that's what we'd want indexed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ORIGIN = "https://ucmc.spencerwill.com";

// One entry per public route. `lastmod` is the build date — close
// enough for crawl prioritization without us having to track per-page
// content changes. `changefreq` is advisory (most modern crawlers
// ignore it) but conventionally accurate.
const PUBLIC_ROUTES: Array<{
  path: string;
  changefreq: "yearly" | "monthly" | "weekly";
  priority: string;
}> = [
  // Homepage — landing content updates on officer edits.
  { path: "/", changefreq: "monthly", priority: "1.0" },
  // Sign-in landing for members + guests.
  { path: "/sign-in", changefreq: "yearly", priority: "0.5" },
  // Static legal/policy pages — change on legal review or
  // constitutional amendment.
  { path: "/legal", changefreq: "yearly", priority: "0.6" },
  { path: "/disclaimer", changefreq: "yearly", priority: "0.6" },
  { path: "/nondiscrimination", changefreq: "yearly", priority: "0.6" },
  { path: "/anti-hazing", changefreq: "yearly", priority: "0.6" },
  { path: "/waiver", changefreq: "yearly", priority: "0.6" },
  { path: "/privacy", changefreq: "yearly", priority: "0.6" },
  { path: "/terms", changefreq: "yearly", priority: "0.6" },
  // About / membership — informational pages, edited rarely.
  { path: "/about", changefreq: "yearly", priority: "0.7" },
  { path: "/membership", changefreq: "yearly", priority: "0.7" },
  // Colophon — bumped when the project's open-source story changes.
  { path: "/open-source", changefreq: "yearly", priority: "0.4" },
];

function buildSitemapXml(): string {
  // ISO date (YYYY-MM-DD) — sitemaps accept both date and full
  // datetime, but date alone is easier to reason about and is what
  // most crawlers expect.
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = PUBLIC_ROUTES.map(
    ({ path, changefreq, priority }) => `  <url>
    <loc>${SITE_ORIGIN}${path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

const __filename = fileURLToPath(import.meta.url);
const outPath = join(dirname(__filename), "..", "public", "sitemap.xml");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buildSitemapXml(), "utf8");
console.log(`[generate-sitemap] wrote ${outPath}`);
