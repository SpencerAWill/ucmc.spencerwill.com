import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { PrivateDetailFields } from "#/components/profile/private-detail-fields";
import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import {
  myEmailsQueryOptions,
  profileQueryOptions,
} from "#/features/auth/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";
import { useSubmitDetails } from "#/features/auth/api/use-submit-details";
import { EmailAddressesSection } from "#/features/auth/components/email-addresses-section";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import { profileInputSchema } from "#/server/profile/profile-schemas";

/**
 * `/my/details` — private profile fields (legal name, phone) plus the
 * member's verified email addresses. Mirrors the server-side
 * `members:view_private` projection: only the user themselves and admins
 * ever see these values.
 *
 * Emails live here rather than on the Security tab: they are personal
 * contact details first and an authentication identifier second, and
 * pairing them with phone gives "how UCMC reaches you" one home. The
 * Security tab is now passkeys only. Emergency contacts moved out to
 * `/my/contacts`; account deletion / data export live on Preferences.
 */
export const Route = createFileRoute("/my/_tabs/details")({
  staticData: { pageFlag: "my_details" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_details");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(myEmailsQueryOptions());
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
    <div className="flex flex-col gap-8">
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
      </div>

      <EmailAddressesSection
        approved={principal.status === "approved"}
        primaryEmail={principal.primaryEmail}
      />

      <p className="text-xs text-muted-foreground">
        Looking for your emergency contacts? Those live on the{" "}
        <Link to="/my/contacts" className="underline">
          Contacts
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
  //
  // `emergencyContacts` is passed straight through from `defaults` even
  // though this page no longer renders it: `submitDetailsFn` takes the
  // whole `detailsInputSchema` shape, so omitting the key would clear
  // the member's contacts on every save from here. Both pages read the
  // same `profileQueryOptions` cache, so the value round-trips intact.
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
            <form.AppForm>
              <form.SubscribeButton label="Save changes" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
