import { createFileRoute, Link } from "@tanstack/react-router";

import { passkeyListQueryOptions } from "#/features/auth/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";
import { PasskeySection } from "#/features/auth/components/passkey-section";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * `/my/security` — registered passkeys. Route path and tab label now
 * agree on "Security"; the tab used to read "Sign-in" over a
 * `/security` URL, which made the two impossible to talk about
 * together.
 *
 * Email addresses moved to the Details tab (they're contact details as
 * much as they are magic-link targets), leaving this page to the
 * credential a member actually manages here. Data export and account
 * deletion live on Preferences — privacy/account-management concerns
 * rather than authentication surface.
 *
 * Auth-gating is inherited from the parent `/my` layout (`my.tsx`),
 * which runs `requireApproved` for the entire `/my/*` namespace.
 */
export const Route = createFileRoute("/my/_tabs/security")({
  staticData: { pageFlag: "my_security" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_security");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(passkeyListQueryOptions());
  },
  component: SecurityPage,
});

function SecurityPage() {
  const { principal } = useAuth();

  if (!principal) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <PasskeySection />

      <p className="text-xs text-muted-foreground">
        Looking to download your data or delete your account? Those live on the{" "}
        <Link to="/my/preferences" className="underline">
          Preferences
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}
