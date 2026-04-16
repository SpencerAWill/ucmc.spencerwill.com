import { createFileRoute } from "@tanstack/react-router";

import { ProfileForm } from "#/components/auth/profile-form";
import { requireProof } from "#/lib/auth/guards";

/**
 * First-time profile completion. Gated on the email-verified proof
 * cookie (NOT a session) so a user can fill it in before any `users`
 * row exists. On submit, `submitProfileFn` upserts the user, upserts
 * the profile, opens a session, clears the proof cookie, and the form
 * navigates to /register/pending.
 */
export const Route = createFileRoute("/register/profile")({
  beforeLoad: async () => {
    const proof = await requireProof();
    return { proof };
  },
  component: ProfilePage,
});

function ProfilePage() {
  const { proof } = Route.useRouteContext();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Finish registering</h1>
        <p className="text-sm text-muted-foreground">
          These details are shared only with UCMC execs for member verification.
        </p>
      </header>
      <ProfileForm email={proof.email} redirectTo="/register/pending" />
    </div>
  );
}
