import { toast } from "sonner";

import { BioFields } from "#/components/profile/bio-fields";
import { useSubmitPublicProfile } from "#/features/auth/api/use-submit-public-profile";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import { profileInputSchema } from "#/server/profile/profile-schemas";

import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import type { PublicProfileInput } from "#/server/profile/profile-schemas";

/**
 * Standalone bio editor with its own Save, the sibling of
 * `ContactsEditor`. Rendered on `/register/pending` so a member can
 * write a bio while waiting on approval; `/my/profile` edits the bio
 * alongside the rest of the public columns in one form instead, since
 * an approved member has no reason to save them separately.
 *
 * `preferredName` and `ucAffiliation` ride along unchanged from
 * `defaults` because `submitPublicProfileFn` takes the whole
 * `publicProfileInputSchema` shape — omitting them would fail
 * validation, and sending stale ones would revert an edit made
 * elsewhere. They come from the same `profileQueryOptions` cache this
 * mutation invalidates.
 *
 * Remount it with a `key` tied to the loaded profile to pick up fresh
 * defaults — `useAppForm` only reads `defaultValues` on mount.
 */
export function BioEditor({ defaults }: { defaults: ProfileFormShape }) {
  const mutation = useSubmitPublicProfile();

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
          preferredName: value.preferredName,
          ucAffiliation: value.ucAffiliation,
          bio: value.bio,
        } as PublicProfileInput,
        {
          onSuccess: () => {
            toast.success("Bio saved");
            // See profile-form.tsx for why this synchronous reset is needed.
            form.reset(form.state.values);
          },
          onError: () => {
            toast.error("Couldn’t save your bio. Please try again.");
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
            <BioFields form={form} />
            <form.AppForm>
              <form.SubscribeButton label="Save changes" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
