import { EMPTY_PROFILE_FORM_VALUES } from "#/features/auth/components/profile-form-shape";
import { withForm } from "#/lib/form/form";
import { cn } from "#/lib/utils";
import {
  BIO_LIMITS,
  countWords,
  PROFILE_LIMITS,
} from "#/features/auth/server/server-fns";

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
 */
export const PublicProfileFields = withForm({
  // All profile-editing forms share one shape — see
  // `profile-form-shape.ts` for the why.
  defaultValues: EMPTY_PROFILE_FORM_VALUES,
  render: function PublicProfileFieldsRender({ form }) {
    return (
      <div className="space-y-4">
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
        <div className="space-y-1">
          <form.AppField name="bio">
            {(field) => (
              <field.TextArea
                label="Bio"
                rows={4}
                placeholder="A short description of yourself — climbing background, what brings you to the club, anything you'd like fellow members to know."
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(s) => s.values.bio}>
            {(value) => {
              const count = countWords(value);
              const over = count > BIO_LIMITS.maxWords;
              return (
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    over && "text-destructive",
                  )}
                >
                  {count} / {BIO_LIMITS.maxWords} words
                </p>
              );
            }}
          </form.Subscribe>
        </div>
      </div>
    );
  },
});
