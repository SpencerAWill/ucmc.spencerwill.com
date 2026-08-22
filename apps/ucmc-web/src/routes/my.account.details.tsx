import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmergencyContactFields } from "#/components/profile/emergency-contact-fields";
import { PrivateDetailFields } from "#/components/profile/private-detail-fields";
import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import { profileQueryOptions } from "#/features/auth/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";
import { useSubmitDetails } from "#/features/auth/api/use-submit-details";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import { profileInputSchema } from "#/server/profile/profile-schemas";

/**
 * `/my/account/details` — private profile fields (legal name, phone)
 * plus emergency contacts. Mirrors the server-side
 * `members:view_private` projection: only the user themselves and
 * admins ever see these values.
 *
 * Email addresses moved to the Sign-in tab because they're an
 * authentication identifier (magic-link target) rather than personal
 * contact info. Account deletion / data export moved to Preferences.
 */
export const Route = createFileRoute("/my/account/details")({
  staticData: { pageFlag: "my_account_details" },
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
  },
  component: AccountDetailsPage,
});

function AccountDetailsPage() {
  const { principal } = useAuth();
  const { data, isLoading } = useQuery(profileQueryOptions());

  if (!principal) {
    return null;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Details</h2>
        <p className="text-sm text-muted-foreground">
          Private information only you and UCMC execs can see. Changes save
          immediately.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DetailsEditor
          key={data?.profile?.updatedAt.toString()}
          defaults={
            data?.profile
              ? {
                  ...EMPTY_PROFILE_FORM_VALUES,
                  fullName: data.profile.fullName,
                  preferredName: data.profile.preferredName,
                  phone: data.profile.phone,
                  ucAffiliation: data.profile.ucAffiliation,
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
        Looking to manage your email addresses? Those live on the{" "}
        <Link to="/my/account/security" className="underline">
          Sign-in
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}

function DetailsEditor({ defaults }: { defaults: ProfileFormShape }) {
  const mutation = useSubmitDetails();

  // Same full-form validation pattern as the Profile tab — see comment
  // there. The form holds every profile field (populated from saved
  // values), but only the Details fields below are editable. Submit
  // picks just the private columns and calls `submitDetailsFn`.
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
          fullName: value.fullName,
          phone: value.phone,
          emergencyContacts: value.emergencyContacts,
        },
        {
          onSuccess: () => {
            toast.success("Details saved");
            // See profile-form.tsx for why this synchronous reset is needed.
            form.reset(form.state.values);
          },
          onError: () => {
            toast.error("Couldn’t save your details. Please try again.");
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
            <PrivateDetailFields form={form} />
            <EmergencyContactFields form={form} />
            <form.AppForm>
              <form.SubscribeButton label="Save changes" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
