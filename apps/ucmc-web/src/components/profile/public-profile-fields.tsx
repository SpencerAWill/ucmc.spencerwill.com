import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { withForm } from "#/lib/form/form";
import { PROFILE_LIMITS } from "#/server/profile/profile-schemas";

const AFFILIATION_OPTIONS = [
  { label: "Student", value: "student" },
  { label: "Faculty", value: "faculty" },
  { label: "Staff", value: "staff" },
  { label: "Alum", value: "alum" },
  { label: "Community", value: "community" },
];

/**
 * Public-ish profile fields: preferred name + UC affiliation. These are
 * the columns visible to fellow members in the directory, so they live
 * on the `/account` Profile tab and on the registration form.
 *
 * Bio is public too but lives in its own `BioFields` group — it's
 * optional, so registration doesn't ask for it and `/register/pending`
 * does. Surfaces that want both render them back to back.
 */
export const PublicProfileFields = withForm({
  // All profile-editing forms share one shape — see
  // `profile-form-shape.ts` for the why.
  defaultValues: EMPTY_PROFILE_FORM_VALUES,
  render: function PublicProfileFieldsRender({ form }) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="preferredName">
          {(field) => (
            <field.TextField
              label="Preferred name"
              autoComplete="nickname"
              maxLength={PROFILE_LIMITS.preferredName.max}
            />
          )}
        </form.AppField>
        <form.AppField name="ucAffiliation">
          {(field) => (
            <field.Select
              label="UC affiliation"
              placeholder="Select one…"
              values={AFFILIATION_OPTIONS}
            />
          )}
        </form.AppField>
      </div>
    );
  },
});
