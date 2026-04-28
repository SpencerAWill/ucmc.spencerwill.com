/**
 * Avatar serving route. Streams the R2 object identified by the splat
 * directly back to the browser with an immutable cache header. The R2
 * key is content-hashed, so each upload changes the URL — the
 * `immutable` directive is safe.
 *
 * Auth-gated to match the `/members` directory policy (any approved
 * member may view another member's avatar; anonymous visitors get 401).
 *
 * The TanStack Start runtime exposes per-route GET handlers via
 * `server.handlers.*` (see `start-server-core/createStartHandler.ts`,
 * `handleServerRoutes`). The route has no `component`, so the handler
 * MUST return a Response — the runtime treats deferring to a renderer
 * as an error in that case.
 */
import { createFileRoute } from "@tanstack/react-router";

const KEY_PATTERN =
  /^avatars\/user_[A-Za-z0-9_-]+\/[a-f0-9]{16}\.(?:webp|jpg|png)$/;

export const Route = createFileRoute("/api/avatars/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { _splat?: string } }) => {
        const { loadCurrentPrincipal } =
          await import("#/features/auth/server/session.server");
        const { getAvatar } = await import("#/server/r2/avatars.server");

        const principal = await loadCurrentPrincipal();
        if (!principal) {
          return new Response("Unauthorized", { status: 401 });
        }

        const key = params._splat ?? "";
        if (!KEY_PATTERN.test(key)) {
          return new Response("Not found", { status: 404 });
        }

        const object = await getAvatar(key);
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
