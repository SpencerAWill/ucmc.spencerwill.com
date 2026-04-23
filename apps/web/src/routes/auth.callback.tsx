import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { consumeMagicLinkFn } from "#/server/auth/server-fns";

const callbackSearchSchema = z.object({
  token: z.string().min(1),
  // Optional post-sign-in destination round-tripped by route guards
  // that redirect anonymous users to /sign-in?redirect=<path>. Only
  // consumed when an approved user lands here — other branches of the
  // decision table have fixed destinations.
  redirect: z.string().optional(),
});

/**
 * Magic-link landing page. Loader-only: it consumes the token, then
 * redirects based on the result. There is no component — the user never
 * sees this route.
 *
 * Decision table (driven by current user state, not the link's intent):
 *
 *   no user row yet      → /register/profile      (proof cookie is set)
 *   user w/o profile     → /register/profile      (session opened)
 *   user + profile, not approved → /register/pending (session opened)
 *   user + profile, approved     → search.redirect ?? "/"
 *
 * Failure paths send the user back to /sign-in with a hint the UI can
 * read so it can show "that link was invalid or already used" without a
 * separate error page.
 */
export const Route = createFileRoute("/auth/callback")({
  validateSearch: callbackSearchSchema,
  loaderDeps: ({ search }) => ({
    token: search.token,
    redirect: search.redirect,
  }),
  loader: async ({ deps }) => {
    const result = await consumeMagicLinkFn({ data: { token: deps.token } });
    if (!result.ok) {
      throw redirect({
        to: "/sign-in",
        search: {
          invalid: result.reason === "invalid" ? true : undefined,
          rate_limited: result.reason === "rate_limited" ? true : undefined,
        },
      });
    }

    if (result.mode === "session") {
      if (!result.hasProfile) {
        throw redirect({ to: "/register/profile" });
      }
      if (result.status !== "approved") {
        throw redirect({ to: "/register/pending" });
      }
      // `redirect` is validated as a string but we only honor it if it
      // looks like an app-internal path — prevents an open-redirect via a
      // crafted magic-link URL.
      const target =
        deps.redirect && deps.redirect.startsWith("/") ? deps.redirect : "/";
      throw redirect({ to: target });
    }

    // mode === "proof" — first-time registrant. Proof cookie is already
    // set server-side; /register/profile reads it via `requireProof`.
    throw redirect({ to: "/register/profile" });
  },
});
