import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ProfileForm } from "#/components/auth/profile-form";
import { useAuth } from "#/lib/auth/use-auth";
import { getProfileFn } from "#/server/auth/server-fns";

/**
 * Default `/account` tab — lets an approved user view and edit their
 * profile. Uses the same `<ProfileForm>` that `/register/profile`
 * renders for first-time registration; the only difference is we
 * pre-fill from the existing profile row and redirect back to
 * `/account` after save (instead of to `/register/pending`).
 */
export const Route = createFileRoute("/account/")({
  component: AccountProfilePage,
});

export const ACCOUNT_PROFILE_QUERY_KEY = ["account", "profile"] as const;

function AccountProfilePage() {
  const { principal } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ACCOUNT_PROFILE_QUERY_KEY,
    queryFn: () => getProfileFn(),
    staleTime: 30_000,
  });

  if (!principal) {
    // requireApproved in the layout's beforeLoad guarantees this, but
    // the narrowing keeps TypeScript happy without a non-null assertion.
    return null;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Profile</h2>
        <p className="text-sm text-muted-foreground">
          Update the details we share with UCMC execs. Changes save immediately.
        </p>
      </header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ProfileForm
          // Key on updatedAt so React remounts the form with fresh
          // defaultValues after a successful save + query refetch.
          // useAppForm only reads defaultValues on mount; without
          // this key the form would retain stale values.
          key={data?.profile?.updatedAt.toString()}
          email={principal.email}
          defaults={
            data?.profile
              ? {
                  ...data.profile,
                  emergencyContacts: data.emergencyContacts.map((c) => ({
                    name: c.name,
                    phone: c.phone,
                    relationship: c.relationship,
                  })),
                }
              : undefined
          }
          redirectTo="/account"
        />
      )}
    </div>
  );
}
