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

import { sanitizeFilenameSegment } from "#/lib/sanitize-filename";

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

        // Prefer the primary email for the file name; fall back to the
        // first verified email, and finally to "account" if (somehow)
        // the export contains no emails. `.at(0)?.email` keeps the
        // empty-array branch in the type so the `?? "account"` fallback
        // is reachable per TS — `payload.emails[0]` would otherwise
        // narrow to non-undefined under the project's tsconfig.
        const primaryEmail =
          payload.emails.find((e) => e.isPrimary)?.email ??
          payload.emails.at(0)?.email;
        const safeIdentifier = sanitizeFilenameSegment(
          primaryEmail ?? "account",
        );
        const date = new Date().toISOString().slice(0, 10);
        const filename = `ucmc-export-${safeIdentifier}-${date}.json`;

        return new Response(JSON.stringify(payload, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
