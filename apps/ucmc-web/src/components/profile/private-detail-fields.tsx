import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { withForm } from "#/lib/form/form";
import { PROFILE_LIMITS } from "#/server/profile/profile-schemas";

/**
 * Private/PII profile fields: legal name and phone. These are the columns
 * nullified server-side for non-`members:view_private` callers in
 * `member-actions.server.ts`, so they live on the `/account/details` tab
 * (and on the combined registration form).
 */
export const PrivateDetailFields = withForm({
  // Shared shape — see `profile-form-shape.ts`.
  defaultValues: EMPTY_PROFILE_FORM_VALUES,
  render: function PrivateDetailFieldsRender({ form }) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="fullName">
          {(field) => (
            <field.TextField
              label="Full name"
              autoComplete="name"
              maxLength={PROFILE_LIMITS.fullName.max}
            />
          )}
        </form.AppField>
        <form.AppField name="phone">
          {(field) => <field.PhoneField label="Phone" />}
        </form.AppField>
      </div>
    );
  },
});
