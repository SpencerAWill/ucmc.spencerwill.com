/**
 * Generated `/sitemap.xml`. Enumerates ONLY public routes —
 * member-data surfaces are auth-gated and don't belong in a
 * crawler-discoverable index. `robots.txt` mirrors this list as a
 * `Disallow:` set so the two stay consistent.
 *
 * Static and small enough that we generate inline rather than
 * persisting a file: the route list almost never changes, the bytes
 * are trivial, and CI deploys are the trigger anyway.
 */
import { createFileRoute } from "@tanstack/react-router";

const SITE_ORIGIN = "https://ucmc.spencerwill.com";

// One entry per public route. `lastmod` is the deploy date — close
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

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildSitemapXml(), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            // Sitemaps don't need to be fresh-on-every-request; an
            // hour of edge cache amortizes a deploy bump.
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
