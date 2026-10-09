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
 *
 * `ProfileIdentityFields` below is a third group for the same reason
 * bio is separate: trail name, pronouns and the status line are all
 * optional colour for the profile header, and asking a prospective
 * member for a trail name before they have been on a trip is the
 * wrong moment. Registration stays short; `/my/profile` offers them.
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

/**
 * The optional one-liners on a member's profile header (#257).
 *
 * All three are free text and all three are allowed to be empty — the
 * header simply omits whatever is not set. The placeholders carry
 * most of the explanation, because a field called "Trail name" means
 * nothing to someone who has not met the convention.
 */
export const ProfileIdentityFields = withForm({
  defaultValues: EMPTY_PROFILE_FORM_VALUES,
  render: function ProfileIdentityFieldsRender({ form }) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="trailName">
            {(field) => (
              <field.TextField
                label="Trail name (optional)"
                placeholder="Switchback"
                description="A nickname the club knows you by, in the trail-name tradition."
                maxLength={PROFILE_LIMITS.trailName.max}
              />
            )}
          </form.AppField>
          <form.AppField name="pronouns">
            {(field) => (
              <field.TextField
                label="Pronouns (optional)"
                placeholder="they/them"
                maxLength={PROFILE_LIMITS.pronouns.max}
              />
            )}
          </form.AppField>
        </div>
        <form.AppField name="statusLine">
          {(field) => (
            <field.TextField
              label="What you're up to (optional)"
              placeholder="Training for my first lead"
              description="One line at the top of your profile. Change it whenever."
              maxLength={PROFILE_LIMITS.statusLine.max}
            />
          )}
        </form.AppField>
      </div>
    );
  },
});
