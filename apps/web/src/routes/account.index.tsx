import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ProfileForm } from "#/components/auth/profile-form";
import { getProfileFn } from "#/server/auth/profile-queries";

export const Route = createFileRoute("/account/")({
  component: AccountProfilePage,
});

function AccountProfilePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["account", "profile"],
    queryFn: () => getProfileFn(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Update your profile information. Changes save immediately.
      </p>
      <ProfileForm
        defaults={data?.profile ?? undefined}
        redirectTo="/account"
      />
    </div>
  );
}
