import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { PROFILE_QUERY_KEY } from "#/features/auth/api/query-keys";
import { profileQueryOptions } from "#/features/auth/api/queries";
import { useSubmitPublicProfile } from "#/features/auth/api/use-submit-public-profile";
import { AvatarEditor } from "#/features/auth/components/avatar-editor";
import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import { PublicProfileFields } from "#/components/profile/public-profile-fields";
import { useAuth } from "#/features/auth/api/use-auth";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import { profileInputSchema } from "#/server/profile/profile-schemas";
import type { PublicProfileInput } from "#/server/profile/profile-schemas";

/**
 * Default `/account` tab — shows the public-ish profile fields
 * (preferred name, UC affiliation) that fellow members can see in the
 * directory. Private fields (legal name, M-number, phone, emergency
 * contacts) live on the sibling `/account/details` route, mirroring
 * the server-side `members:view_private` projection split.
 */
export const Route = createFileRoute("/account/")({
  component: AccountProfilePage,
});

// Re-exported so existing importers (e.g. account.details.tsx) keep
// working; canonical location is `#/features/auth/api/query-keys`.
export { PROFILE_QUERY_KEY as ACCOUNT_PROFILE_QUERY_KEY } from "#/features/auth/api/query-keys";

function AccountProfilePage() {
  const { principal, refresh } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(profileQueryOptions());

  if (!principal) {
    return null;
  }

  const avatarKey = data?.profile?.avatarKey ?? null;
  const preferredName = data?.profile?.preferredName ?? "";

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Profile</h2>
        <p className="text-sm text-muted-foreground">
          What other UCMC members see about you. Changes save immediately.
        </p>
      </header>
      <AvatarEditor
        avatarKey={avatarKey}
        name={preferredName || principal.email}
        onChanged={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }),
            refresh(),
          ]);
        }}
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <PublicProfileEditor
          // Remount with fresh defaults after a save + refetch — useAppForm
          // only reads defaultValues on mount.
          key={data?.profile?.updatedAt.toString()}
          defaults={
            data?.profile
              ? {
                  ...EMPTY_PROFILE_FORM_VALUES,
                  fullName: data.profile.fullName,
                  preferredName: data.profile.preferredName,
                  mNumber: data.profile.mNumber,
                  phone: data.profile.phone,
                  ucAffiliation: data.profile.ucAffiliation,
                  bio: data.profile.bio ?? "",
                  emergencyContacts: data.emergencyContacts.map((c) => ({
                    name: c.name,
                    phone: c.phone,
                    relationship: c.relationship,
                  })),
                }
              : EMPTY_PROFILE_FORM_VALUES
          }
        />
      )}
      <p className="text-xs text-muted-foreground">
        Looking for your phone, legal name, or emergency contacts? Those live on
        the{" "}
        <Link to="/account/details" className="underline">
          Details
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}

function PublicProfileEditor({ defaults }: { defaults: ProfileFormShape }) {
  const mutation = useSubmitPublicProfile();

  // Form holds the shared full shape so `PublicProfileFields` (which
  // declares the same shape via `withForm`) matches its prop type. Only
  // the fields rendered below are editable; the rest pass through
  // unchanged from `defaults` (which come from the saved profile, so
  // they're already valid). The full `profileInputSchema` validates
  // the whole shape; submit picks just the public-ish columns and
  // calls `submitPublicProfileFn`.
  const form = useAppForm({
    defaultValues: defaults,
    validators: {
      onMount: profileInputSchema,
      onChange: profileInputSchema,
      onBlur: profileInputSchema,
      onSubmit: profileInputSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(
        {
          preferredName: value.preferredName,
          ucAffiliation: value.ucAffiliation,
          bio: value.bio,
        } as PublicProfileInput,
        {
          onSuccess: () => {
            toast.success("Profile saved");
            // Mark current values as new defaults so the unsaved-
            // changes guard treats the form as clean. See profile-
            // form.tsx for why a synchronous form.reset is needed.
            form.reset(form.state.values);
          },
          onError: () => {
            toast.error("Couldn’t save your profile. Please try again.");
          },
        },
      );
    },
  });

  useUnsavedChangesGuard(form, { skip: () => mutation.isSuccess });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <fieldset disabled={isSubmitting} className="space-y-6 border-0 p-0">
            <PublicProfileFields form={form} />
            <form.AppForm>
              <form.SubscribeButton label="Save changes" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
