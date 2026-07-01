/**
 * Gear thumbnail serving route — local-dev fallback only.
 *
 * In deployed envs, `gearThumbnailUrlFor` emits
 * `https://${VITE_R2_PUBLIC_HOST}/gear/<hash>.<ext>` and the R2 custom
 * domain serves bytes directly. This worker route exists so local dev
 * (with `VITE_R2_PUBLIC_HOST` unset) can read thumbnails out of
 * Miniflare's `BUCKET_PUBLIC` namespace.
 *
 * No auth — gear thumbnails are accessible to anyone with a gear
 * publicId, but the publicId itself is opaque + only exposed through
 * routes that gate on `gear:read`. The bytes themselves aren't
 * sensitive (they're stock product photos), so the indirection is
 * enough.
 *
 * Mirrors `apps/ucmc-web/src/routes/api/landing.$.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";

// Splat shape is `<gearId>/<contentHash>.<ext>` — the R2 prefix
// `gear/` is added server-side. `gearId` is the internal D1 id which
// is `g_<uuidv7>` (alphanumerics + underscore + hyphen).
const SPLAT_PATTERN = /^[a-z0-9_-]+\/[a-f0-9]{16}\.(?:webp|jpg|png)$/;

export const Route = createFileRoute("/api/gear-thumbnails/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { _splat?: string } }) => {
        const { getGearThumbnail } =
          await import("#/features/gear/server/gear-image.server");

        const splat = params._splat ?? "";
        if (!SPLAT_PATTERN.test(splat)) {
          return new Response("Not found", { status: 404 });
        }
        const key = `gear/${splat}`;

        const object = await getGearThumbnail(key);
        if (!object) {
          return new Response("Not found", { status: 404 });
        }

        const contentType =
          object.httpMetadata?.contentType ??
          (key.endsWith(".webp")
            ? "image/webp"
            : key.endsWith(".png")
              ? "image/png"
              : "image/jpeg");

        return new Response(object.body, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            ETag: object.httpEtag,
          },
        });
      },
    },
  },
});
