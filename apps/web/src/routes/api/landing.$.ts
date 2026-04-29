/**
 * Public landing-image serving route. Streams R2 objects under the
 * `landing/` prefix straight to the browser. No auth — the home page is
 * public and these images are part of it.
 *
 * Keys are content-hashed (`landing/hero/<hash>.<ext>`) so each upload
 * produces a new URL — `Cache-Control: immutable` is safe.
 *
 * Mirrors `apps/web/src/routes/api/avatars.$.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";

// Splat shape is `<subdir>/<contentHash>.<ext>` — the R2 prefix `landing/`
// is added server-side rather than included in the URL, so the public path
// reads cleanly as `/api/landing/hero/<hash>.webp`.
const SPLAT_PATTERN = /^[a-z0-9_-]+\/[a-f0-9]{16}\.(?:webp|jpg|png)$/;

export const Route = createFileRoute("/api/landing/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { _splat?: string } }) => {
        const { getLandingImage } =
          await import("#/features/landing/server/landing-image.server");

        const splat = params._splat ?? "";
        if (!SPLAT_PATTERN.test(splat)) {
          return new Response("Not found", { status: 404 });
        }
        const key = `landing/${splat}`;

        const object = await getLandingImage(key);
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
