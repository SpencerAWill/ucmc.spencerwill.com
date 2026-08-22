import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmergencyContactFields } from "#/components/profile/emergency-contact-fields";
import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import { profileQueryOptions } from "#/features/auth/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";
import { useSubmitDetails } from "#/features/auth/api/use-submit-details";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import { profileInputSchema } from "#/server/profile/profile-schemas";

/**
 * `/my/contacts` — the member's emergency contacts, split out of the
 * Details tab onto their own page. They're the one part of a profile an
 * officer reads in an actual emergency (Bylaw 1.3 trip safety), so they
 * get a URL that can be pointed at directly instead of being buried
 * below legal name and phone.
 *
 * Same privacy class as Details: `members:view_private` only. Writes go
 * through the shared `submitDetailsFn`, so this page passes `fullName`
 * and `phone` through unchanged from the loaded profile — see the
 * comment on `ContactsEditor`.
 */
export const Route = createFileRoute("/my/_tabs/contacts")({
  staticData: { pageFlag: "my_contacts" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_contacts");
  },
  component: AccountContactsPage,
});

function AccountContactsPage() {
  const { principal } = useAuth();
  const { data, isLoading } = useQuery(profileQueryOptions());

  if (!principal) {
    return null;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Emergency contacts</h2>
        <p className="text-sm text-muted-foreground">
          Who UCMC should call if something happens to you on a trip. Only you
          and UCMC execs can see these. Changes save immediately.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ContactsEditor
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
        Looking for your own phone number or legal name? Those live on the{" "}
        <Link to="/my/details" className="underline">
          Details
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}

function ContactsEditor({ defaults }: { defaults: ProfileFormShape }) {
  const mutation = useSubmitDetails();

  // The form holds the whole shared profile shape (see
  // `profile-form-shape.ts` — `withForm`'s generics are invariant, so
  // every profile form declares the same shape). Only the emergency
  // contacts below are editable here.
  //
  // `fullName` and `phone` are submitted unchanged from `defaults`
  // because `submitDetailsFn` takes the whole `detailsInputSchema`
  // shape — dropping them would blank the member's legal name and phone
  // on every save from this page. They come from the saved profile via
  // the same `profileQueryOptions` cache the Details tab writes to, so
  // they're already valid and current.
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
            toast.success("Emergency contacts saved");
            // See profile-form.tsx for why this synchronous reset is needed.
            form.reset(form.state.values);
          },
          onError: () => {
            toast.error("Couldn’t save your contacts. Please try again.");
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
