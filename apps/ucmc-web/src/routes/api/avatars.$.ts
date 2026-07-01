/**
 * Avatar serving route — local-dev fallback only.
 *
 * In deployed envs, `avatarUrlFor` (in `apps/ucmc-web/src/components/user-avatar.tsx`)
 * emits `https://${VITE_R2_PUBLIC_HOST}/<key>` and the R2 custom domain
 * (`cdn.{dev.,}ucmc.spencerwill.com`) serves bytes directly — this
 * worker route never sees production traffic. It exists so that local
 * dev (`pnpm --filter ucmc-web dev`, `VITE_R2_PUBLIC_HOST` unset) can
 * still read avatars out of Miniflare's `BUCKET_PUBLIC` namespace,
 * which has no DNS surface.
 *
 * Streams the R2 object identified by the splat back to the browser
 * with an immutable cache header. The R2 key is content-hashed, so
 * each upload changes the URL — `immutable` is safe.
 *
 * Auth-gated to match the `/members` directory policy (any approved
 * member may view another member's avatar; anonymous visitors get 401).
 * The gate is also a defense-in-depth fallback in case `VITE_R2_PUBLIC_HOST`
 * is misconfigured in a deployed env and traffic flows through here.
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
        const { loadCurrentSession } =
          await import("#/server/auth/session.server");
        const { getAvatar } = await import("#/server/r2/avatars.server");

        // Lightweight session check only — avatar bytes don't need the
        // full principal, so we skip the RBAC/profile/email joins +
        // sliding-refresh write that loadCurrentPrincipal pays for.
        // See loadCurrentSession() in session.server.ts.
        const session = await loadCurrentSession();
        if (!session) {
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
