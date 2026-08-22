/**
 * Album image serving route — local-dev fallback only.
 *
 * In deployed envs, `albumImageUrl()` (in
 * `apps/ucmc-web/src/features/album/lib/image-url.ts`) emits
 * `https://${VITE_R2_PUBLIC_HOST}/<key>` and the R2 custom domain
 * serves bytes directly — this worker route never sees production
 * traffic. It exists so that local dev (`pnpm --filter ucmc-web dev`,
 * `VITE_R2_PUBLIC_HOST` unset) can still read Album photos out of
 * Miniflare's `BUCKET_PUBLIC` namespace.
 *
 * Streams R2 objects under the album R2 prefix straight to the
 * browser. No auth check — Album images are public-CDN content;
 * the `public_album:view` permission gates discovery (sidebar +
 * list page) but bytes themselves are URL-keyed and content-hashed.
 *
 * Mirrors `apps/ucmc-web/src/routes/api/gazette-pdf.$.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";

import { ALBUM_R2_PREFIX } from "#/features/album/lib/image-url";

// Splat shape is `<id>/<contentHash>.webp` — the R2 prefix is added
// back server-side so the public path reads cleanly as
// `/api/album-image/<id>/<hash>.webp`. The prefix is imported rather
// than spelled out here because `albumImageUrl()` strips exactly this
// string; a local literal is how the two drifted apart during the
// Trip Gallery → Album rename.
const SPLAT_PATTERN = /^[0-9a-z-]+\/[a-f0-9]{16}\.webp$/;

export const Route = createFileRoute("/api/album-image/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { _splat?: string } }) => {
        const { getPublicBucket } = await import("#/server/r2");

        const splat = params._splat ?? "";
        if (!SPLAT_PATTERN.test(splat)) {
          return new Response("Not found", { status: 404 });
        }
        const key = `${ALBUM_R2_PREFIX}${splat}`;

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
