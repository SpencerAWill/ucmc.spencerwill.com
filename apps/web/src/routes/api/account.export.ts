/**
 * Self-serve data export. Returns a downloadable JSON bundle of every
 * piece of data the site stores about the caller — the implementation
 * of the "download my data" promise on /privacy.
 *
 * The data assembly + exclusion policy lives in
 * `exportMyDataAction` (`magic-link-actions.server.ts`) so it's
 * unit-testable; this route handler is just the HTTP envelope (auth
 * 401 + Content-Disposition: attachment).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/account/export")({
  server: {
    handlers: {
      GET: async () => {
        const { exportMyDataAction } =
          await import("#/features/auth/server/magic-link-actions.server");

        let payload;
        try {
          payload = await exportMyDataAction();
        } catch (err) {
          if (err instanceof Error && err.message === "Not signed in") {
            return new Response("Unauthorized", { status: 401 });
          }
          throw err;
        }

        const filename = `ucmc-export-${payload.user?.email ?? "account"}-${new Date().toISOString().slice(0, 10)}.json`;

        return new Response(JSON.stringify(payload, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
