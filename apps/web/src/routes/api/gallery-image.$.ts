/**
 * Gallery image serving route — local-dev fallback only.
 *
 * In deployed envs, `galleryImageUrl()` (in
 * `apps/web/src/features/gallery/lib/image-url.ts`) emits
 * `https://${VITE_R2_PUBLIC_HOST}/<key>` and the R2 custom domain
 * serves bytes directly — this worker route never sees production
 * traffic. It exists so that local dev (`pnpm --filter ucmc-web dev`,
 * `VITE_R2_PUBLIC_HOST` unset) can still read Gallery photos out of
 * Miniflare's `BUCKET_PUBLIC` namespace.
 *
 * Streams R2 objects under the `gallery/` prefix straight to the
 * browser. No auth check — Gallery images are public-CDN content;
 * the `public_gallery:view` permission gates discovery (sidebar +
 * list page) but bytes themselves are URL-keyed and content-hashed.
 *
 * Mirrors `apps/web/src/routes/api/gazette-pdf.$.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";

// Splat shape is `<id>/<contentHash>.webp` — the R2 prefix `gallery/`
// is added server-side so the public path reads cleanly as
// `/api/gallery-image/<id>/<hash>.webp`.
const SPLAT_PATTERN = /^[0-9a-z-]+\/[a-f0-9]{16}\.webp$/;

export const Route = createFileRoute("/api/gallery-image/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { _splat?: string } }) => {
        const { getPublicBucket } = await import("#/server/r2");

        const splat = params._splat ?? "";
        if (!SPLAT_PATTERN.test(splat)) {
          return new Response("Not found", { status: 404 });
        }
        const key = `gallery/${splat}`;

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
