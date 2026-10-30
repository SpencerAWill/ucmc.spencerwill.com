import { createFileRoute } from "@tanstack/react-router";

/**
 * The dev email outbox (#297). 404 unless the outbox is on, 403 without
 * a valid Cloudflare Access token — see
 * `src/server/email/outbox-page.server.ts`.
 *
 * No sidebar entry, deliberately: it is a developer tool on one stack,
 * not a page of the site, and a nav link would advertise a path whose
 * whole design is that almost nobody can open it.
 */
export const Route = createFileRoute("/dev/outbox")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const [{ serverEnv }, { emailTier }, { handleOutbox }, { listOutbox }] =
          await Promise.all([
            import("#/server/env.server"),
            import("#/server/email/email-tier"),
            import("#/server/email/outbox-page.server"),
            import("#/server/email/outbox.server"),
          ]);
        const env = serverEnv();
        return handleOutbox(
          request,
          {
            // The sender's own answer, not a second reading of the vars:
            // with MAILPIT_URL also set, mail goes to Mailpit, and a page
            // saying "Nothing yet." would be lying.
            enabled: emailTier(env).tier === "outbox",
            teamDomain: env.ACCESS_TEAM_DOMAIN,
            aud: env.ACCESS_OUTBOX_AUD,
            appBaseUrl: env.APP_BASE_URL,
          },
          () => listOutbox(),
        );
      },
    },
  },
});
