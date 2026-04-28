import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "#/features/auth/guards";

/**
 * Holding page for approved-but-not-yet-active members. Requires a
 * session but NOT approval — that's the whole point.
 */
export const Route = createFileRoute("/register/pending")({
  beforeLoad: async ({ context }) => {
    const principal = await requireAuth(context.queryClient);
    return { principal };
  },
  component: PendingPage,
});

function PendingPage() {
  const { principal } = Route.useRouteContext();
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Thanks for registering!</h1>
        <p className="text-sm text-muted-foreground">
          An exec will review <strong>{principal.email}</strong> and
          you&rsquo;ll get an email when you&rsquo;re approved. You can close
          this tab — we won&rsquo;t hold anything up.
        </p>
      </header>
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        Until you&rsquo;re approved, most of the site is hidden. If you need to
        update your details, come back here after signing in again.
      </div>
    </div>
  );
}
