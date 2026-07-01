import { createFileRoute } from "@tanstack/react-router";

import { ProfileForm } from "#/features/auth/components/profile-form";
import { requireRegistrationContext } from "#/features/auth/guards";

/**
 * First-time profile completion. Reachable two ways from the magic-link
 * callback:
 *   - First-time registrant (no user row yet) — consume sets a proof
 *     cookie, route accepts it, submit creates the user + profile and
 *     opens a session.
 *   - Returning user with no profile (rare, but possible if a prior
 *     submit was interrupted, or a CSV import created the user row
 *     ahead of profile completion) — consume opens a session directly,
 *     route accepts that, submit upserts the profile against the
 *     existing user.
 *
 * On submit, `submitProfileFn` either inserts or upserts the user,
 * upserts the profile, opens a session if one isn't already open,
 * clears the proof cookie if present, and the form navigates to
 * /register/pending.
 */
export const Route = createFileRoute("/register/profile")({
  beforeLoad: async ({ context }) => {
    const reg = await requireRegistrationContext(context.queryClient);
    return { reg };
  },
  component: ProfilePage,
});

function ProfilePage() {
  const { reg } = Route.useRouteContext();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Finish registering</h1>
        <p className="text-sm text-muted-foreground">
          These details are shared only with UCMC execs for member verification.
        </p>
      </header>
      <ProfileForm email={reg.email} redirectTo="/register/pending" />
    </div>
  );
}
