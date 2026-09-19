import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { withForm } from "#/lib/form/form";
import { cn } from "#/lib/utils";
import { BIO_LIMITS, countWords } from "#/server/profile/profile-schemas";

/**
 * Copy for a member editing their own bio. The admin sheet overrides it
 * — an officer writing someone else's bio is a different voice.
 */
const SELF_PLACEHOLDER =
  "A short description of yourself — climbing background, what brings you to the club, anything you'd like fellow members to know.";

/**
 * Declared as a typed constant rather than inline, so `placeholder`
 * infers as optional — an inline `props` object makes `withForm` demand
 * the key at every call site, and only the admin sheet overrides it.
 */
const DEFAULT_PROPS: { placeholder?: string } = {
  placeholder: SELF_PLACEHOLDER,
};

/**
 * The bio textarea and its live word counter.
 *
 * Split out of `PublicProfileFields` because bio is the one public
 * column that isn't required at registration: `/register/profile` now
 * collects only what an exec needs to approve an account, and the bio
 * is offered on `/register/pending` while the member waits. The admin
 * profile sheet had its own copy of this markup — counter included —
 * which is why this is a shared group rather than a second inline
 * block.
 *
 * The counter mirrors the `BIO_LIMITS.maxWords` refine on
 * `profileInputSchema`, so it turns destructive at exactly the point
 * the field turns invalid.
 */
export const BioFields = withForm({
  // All profile-editing forms share one shape — see
  // `profile-form-shape.ts` for the why.
  defaultValues: EMPTY_PROFILE_FORM_VALUES,
  props: DEFAULT_PROPS,
  render: function BioFieldsRender({ form, placeholder }) {
    return (
      <div className="space-y-1">
        <form.AppField name="bio">
          {(field) => (
            <field.TextArea label="Bio" rows={4} placeholder={placeholder} />
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
    );
  },
});
