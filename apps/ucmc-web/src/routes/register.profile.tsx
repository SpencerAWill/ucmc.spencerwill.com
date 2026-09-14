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
 * The form asks only for what an exec needs to review the account.
 * Emergency contacts and the bio are optional, so they live on
 * /register/pending where a member can add them while they wait —
 * the dynamic contacts list is the worst thing on this page to
 * operate on a phone, and nothing about it gates approval.
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
          You can add emergency contacts and a short bio on the next page.
        </p>
      </header>
      <ProfileForm email={reg.email} redirectTo="/register/pending" />
    </div>
  );
}
