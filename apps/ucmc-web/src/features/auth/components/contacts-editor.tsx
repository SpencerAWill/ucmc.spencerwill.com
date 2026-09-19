import { toast } from "sonner";

import { EmergencyContactFields } from "#/components/profile/emergency-contact-fields";
import { useSubmitDetails } from "#/features/auth/api/use-submit-details";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import { profileInputSchema } from "#/server/profile/profile-schemas";

import type { ProfileFormShape } from "#/components/profile/profile-form-shape";

/**
 * Self-service editor for the member's emergency contacts, with its own
 * Save. Rendered on `/my/contacts` and on `/register/pending`, where a
 * member waiting on approval can add contacts they skipped during
 * registration. `submitDetailsFn` needs a session but not an approved
 * account, which is what makes the pending-page use legal.
 *
 * Remount it with a `key` tied to the loaded profile to pick up fresh
 * defaults — `useAppForm` only reads `defaultValues` on mount.
 */
export function ContactsEditor({ defaults }: { defaults: ProfileFormShape }) {
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
