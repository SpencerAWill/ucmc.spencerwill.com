/**
 * A site-feedback report's screenshot, from the private bucket.
 *
 * Only the submitter and site maintainers may read it; everyone else —
 * signed out, another member, a missing or purged report — gets the same
 * 404, so the route says nothing about which reports have screenshots.
 * `private, no-store` keeps the image out of shared caches and off disk,
 * and `nosniff` holds the browser to the stored image type.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/site-feedback/$id/screenshot")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { getSiteFeedbackScreenshotAction } =
          await import("#/features/site-feedback/server/site-feedback-actions.server");
        const image = await getSiteFeedbackScreenshotAction(params.id);
        if (!image) {
          return new Response("Not found", {
            status: 404,
            headers: { "Cache-Control": "private, no-store" },
          });
        }
        return new Response(image.body, {
          headers: {
            "Content-Type": image.contentType,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
          },
        });
      },
    },
  },
});
