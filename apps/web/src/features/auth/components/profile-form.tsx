import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { z } from "zod";

import { EmergencyContactFields } from "#/components/profile/emergency-contact-fields";
import { PrivateDetailFields } from "#/components/profile/private-detail-fields";
import { PublicProfileFields } from "#/components/profile/public-profile-fields";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useSubmitProfile } from "#/features/auth/api/use-submit-profile";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import type { EmergencyContactInput } from "#/server/profile/profile-schemas";
import { profileInputSchema } from "#/server/profile/profile-schemas";

type ProfileInput = z.infer<typeof profileInputSchema>;

export interface ProfileFormDefaults {
  fullName?: string;
  preferredName?: string;
  phone?: string;
  emergencyContacts?: EmergencyContactInput[];
  ucAffiliation?: "student" | "faculty" | "staff" | "alum" | "community" | "";
  bio?: string;
}

export function ProfileForm({
  email,
  defaults,
  redirectTo = "/register/pending",
}: {
  /**
   * Shown as a read-only field at the top of the form. Comes from the
   * email-verified proof cookie (registration path) or the signed-in
   * principal (edit path) — either way it's something the user can't
   * change here; they'd need to re-verify a new email.
   */
  email: string;
  defaults?: ProfileFormDefaults;
  redirectTo?: "/register/pending" | "/" | "/account";
}) {
  const navigate = useNavigate();

  const mutation = useSubmitProfile();

  const form = useAppForm({
    defaultValues: {
      fullName: defaults?.fullName ?? "",
      preferredName: defaults?.preferredName ?? "",
      phone: defaults?.phone ?? "",
      emergencyContacts: defaults?.emergencyContacts ?? [],
      ucAffiliation: defaults?.ucAffiliation ?? "",
      bio: defaults?.bio ?? "",
    },
    // onMount validates once on load — if defaults are invalid (e.g.
    // empty required fields on the registration form), form-level
    // errors are set. onBlur establishes the first visible validation
    // per field; onChange re-runs on every keystroke so invalid → valid
    // transitions flip red to green immediately. onSubmit is the final
    // gate.
    validators: {
      onMount: profileInputSchema,
      onChange: profileInputSchema,
      onBlur: profileInputSchema,
      onSubmit: profileInputSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(value as ProfileInput, {
        onSuccess: async () => {
          toast.success("Profile submitted");
          // Mark the current values as the new defaults so the
          // unsaved-changes guard sees `isDefaultValue: true`
          // synchronously. The guard reads `form.state` directly
          // inside its blocker callback, so this short-circuits the
          // prompt for the navigate() below — `mutation.isSuccess`
          // alone wouldn't work because React doesn't re-render
          // between this onSuccess and navigate (microtask awaits
          // don't flush React).
          form.reset(form.state.values);
          await navigate({ to: redirectTo });
        },
        onError: () => {
          toast.error("Couldn’t save your profile. Please try again.");
        },
      });
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
      {/* `fieldset disabled` natively disables every form control inside
          it (inputs, selects, the submit button), so we get full-form
          lockout during submission with no per-field plumbing. */}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <fieldset disabled={isSubmitting} className="space-y-6 border-0 p-0">
            <div className="space-y-1.5">
              <Label htmlFor="profile-email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="profile-email"
                type="email"
                value={email}
                readOnly
                // Rendered in the form so a reviewer/autofill context
                // knows whose profile this is, but editing the email
                // means re-verifying via magic link — not a field-level
                // change.
                aria-describedby="profile-email-hint"
                className="bg-muted/40"
              />
              <p
                id="profile-email-hint"
                className="text-xs text-muted-foreground"
              >
                To change your email, sign out and re-register with the new
                address.
              </p>
            </div>
            <PublicProfileFields form={form} />
            <PrivateDetailFields form={form} />

            <EmergencyContactFields form={form} />

            <form.AppForm>
              <form.SubscribeButton label="Submit for review" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
