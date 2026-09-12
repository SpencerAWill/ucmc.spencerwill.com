/**
 * Sponsor logo serving route — local-dev fallback only.
 *
 * In deployed envs `sponsorLogoUrl()` emits
 * `https://${VITE_R2_PUBLIC_HOST}/<key>` and the R2 custom domain serves
 * the bytes directly, so this worker route never sees production
 * traffic. It exists so local dev (`VITE_R2_PUBLIC_HOST` unset) can read
 * logos out of Miniflare's `BUCKET_PUBLIC`.
 *
 * No auth check — logos are public-CDN content and are the sponsors'
 * own marks, published to be seen. `public_sponsors:view` gates
 * discovery (sidebar + page), not the bytes, which are URL-keyed and
 * content-hashed.
 *
 * Mirrors `apps/ucmc-web/src/routes/api/album-image.$.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";

import { SPONSOR_R2_PREFIX } from "#/features/sponsors/lib/logo-url";

// Splat shape is `<id>/<contentHash>.webp`. The prefix is imported
// rather than spelled out because `sponsorLogoUrl()` strips exactly this
// string — a local literal is how the Album's pair drifted apart.
const SPLAT_PATTERN = /^[0-9a-z-]+\/[a-f0-9]{16}\.webp$/;

export const Route = createFileRoute("/api/sponsor-logo/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { _splat?: string } }) => {
        const { getPublicBucket } = await import("#/server/r2");

        const splat = params._splat ?? "";
        if (!SPLAT_PATTERN.test(splat)) {
          return new Response("Not found", { status: 404 });
        }
        const key = `${SPONSOR_R2_PREFIX}${splat}`;

        const object = await getPublicBucket().get(key);
        if (!object) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(object.body, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
            ETag: object.httpEtag,
          },
        });
      },
    },
  },
});
