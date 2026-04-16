import { createFileRoute } from "@tanstack/react-router";

import { requireProof } from "#/lib/auth/guards";

/**
 * First-time profile completion. Gated on the email-verified proof
 * cookie (NOT a session) so a user can fill it in before any `users` row
 * exists. On submit (Phase 4d.2) we upsert the user, open a session,
 * clear the proof cookie, and redirect to /register/pending.
 *
 * This commit ships the guard + a stub — the real form lands in the
 * next sub-phase.
 */
export const Route = createFileRoute("/register/profile")({
  beforeLoad: async () => {
    const proof = await requireProof();
    return { proof };
  },
  component: ProfileStub,
});

function ProfileStub() {
  const { proof } = Route.useRouteContext();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Finish registering</h1>
        <p className="text-sm text-muted-foreground">
          Signing up as <strong>{proof.email}</strong>.
        </p>
      </header>
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Profile form coming in the next commit. For now, this page just confirms
        the proof cookie was set correctly by <code>/auth/callback</code>.
      </p>
    </div>
  );
}
