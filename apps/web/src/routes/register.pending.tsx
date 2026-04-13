import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { requireAuth } from "#/lib/auth/guards";
import { useAuth } from "#/lib/auth/use-auth";

export const Route = createFileRoute("/register/pending")({
  beforeLoad: async ({ context }) => {
    const principal = await requireAuth(
      context.queryClient,
      "/register/pending",
    );
    // Already approved? Skip the landing and go home.
    if (principal.status === "approved" && principal.hasProfile) {
      throw redirect({ to: "/" });
    }
  },
  component: PendingPage,
});

function PendingPage() {
  const { principal } = useAuth();
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-12 text-center">
      <h1 className="text-2xl font-semibold">Application received</h1>
      <p className="text-muted-foreground text-sm">
        Thanks{principal ? `, ${principal.email}` : ""}. An exec member will
        review your application and you’ll get an email when it’s approved.
      </p>
      <p className="text-muted-foreground text-sm">
        Need to update your information?{" "}
        <Link
          to="/register/profile"
          className="text-primary underline-offset-4 hover:underline"
        >
          Edit your profile
        </Link>
        .
      </p>
    </div>
  );
}
