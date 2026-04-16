import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { consumeMagicLinkFn } from "#/server/auth/server-fns";

const callbackSearchSchema = z.object({
  token: z.string().min(1),
});

/**
 * Magic-link landing page. Loader-only: it consumes the token, writes the
 * proof cookie (or session, once Phase 5 extends the server fn), and
 * redirects. There is no component — the user never sees this route.
 *
 * Failure paths send the user back to /sign-in with a hint the UI can
 * read so it can show "that link was invalid or already used" without a
 * separate error page.
 */
export const Route = createFileRoute("/auth/callback")({
  validateSearch: callbackSearchSchema,
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const result = await consumeMagicLinkFn({ data: { token: deps.token } });
    if (!result.ok) {
      throw redirect({ to: "/sign-in", search: { invalid: true } });
    }
    // Phase 4: proof cookie is set; next step is profile completion.
    // Phase 5 will extend consumeMagicLinkFn to open a session directly
    // for existing users and redirect them somewhere else based on
    // intent.
    throw redirect({ to: "/register/profile" });
  },
});
