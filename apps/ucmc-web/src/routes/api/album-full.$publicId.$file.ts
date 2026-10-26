/**
 * The full-size, metadata-free copy of an Album photo, for members.
 *
 * Every refusal (signed out, no `public_album:view_original`, unknown or
 * legacy photo, stale hash, failed self-repair) is the same 404, so the
 * route says nothing about which photos have originals. Success is
 * `private` so the long-lived cache stays out of shared caches; the URL
 * carries the original's hash, which changes with the image.
 */
import { createFileRoute } from "@tanstack/react-router";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const Route = createFileRoute("/api/album-full/$publicId/$file")({
  server: {
    handlers: {
      GET: async ({
        params,
        request,
      }: {
        params: { publicId: string; file: string };
        request: Request;
      }) => {
        const { getAlbumFullImageAction } =
          await import("#/features/album/server/album-original-actions.server");
        const image = await getAlbumFullImageAction(
          params.publicId,
          params.file,
        );
        if (!image) {
          return notFound();
        }
        const download =
          new URL(request.url).searchParams.get("download") === "1";
        return new Response(image.body, {
          headers: {
            "Content-Type": "image/webp",
            "Content-Length": String(image.bytes),
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": download
              ? `attachment; filename="ucmc-${image.publicId}.webp"`
              : "inline",
          },
        });
      },
    },
  },
});
