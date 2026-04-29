import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmergencyContactFields } from "#/components/profile/emergency-contact-fields";
import { PrivateDetailFields } from "#/components/profile/private-detail-fields";
import { PublicProfileFields } from "#/components/profile/public-profile-fields";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useSubmitProfile } from "#/features/auth/api/use-submit-profile";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import type {
  EmergencyContactInput,
  RegistrationInput,
} from "#/server/profile/profile-schemas";
import { registrationInputSchema } from "#/server/profile/profile-schemas";

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
      // Always starts unchecked — registration requires the user to
      // tick it before submit; non-registration paths never look at
      // this field.
      policiesAck: false,
    },
    // onMount validates once on load — if defaults are invalid (e.g.
    // empty required fields on the registration form), form-level
    // errors are set. onBlur establishes the first visible validation
    // per field; onChange re-runs on every keystroke so invalid → valid
    // transitions flip red to green immediately. onSubmit is the final
    // gate.
    validators: {
      onMount: registrationInputSchema,
      onChange: registrationInputSchema,
      onBlur: registrationInputSchema,
      onSubmit: registrationInputSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(value as RegistrationInput, {
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

            {/*
              Policies acknowledgment — required at registration to
              persist `policiesAcknowledgedAt` + `policiesVersion` on
              the profile row. Anti-hazing + non-discrimination are
              constitutionally and statutorily required (Const Art XII,
              Ohio SB 1, CAMPUS Act).
            */}
            <form.AppField name="policiesAck">
              {(field) => (
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={field.name}
                      checked={field.state.value}
                      onCheckedChange={(checked) =>
                        field.handleChange(checked === true)
                      }
                      onBlur={field.handleBlur}
                    />
                    <Label
                      htmlFor={field.name}
                      className="text-sm font-normal leading-snug"
                    >
                      I have read and acknowledge UCMC's{" "}
                      <a
                        href="/anti-hazing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4"
                      >
                        Anti-Hazing
                      </a>{" "}
                      and{" "}
                      <a
                        href="/nondiscrimination"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4"
                      >
                        Non-Discrimination
                      </a>{" "}
                      policies.
                    </Label>
                  </div>
                  {field.state.meta.isTouched &&
                  field.state.meta.errors.length > 0 ? (
                    <p className="ml-6 text-xs text-destructive">
                      {typeof field.state.meta.errors[0] === "string"
                        ? field.state.meta.errors[0]
                        : (field.state.meta.errors[0]?.message ??
                          "Please acknowledge the policies to continue")}
                    </p>
                  ) : null}
                </div>
              )}
            </form.AppField>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">After approval</p>
              <p className="mt-1 text-muted-foreground">
                You'll need to print and sign UCMC's{" "}
                <a
                  href="/waiver"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  paper waiver of liability
                </a>{" "}
                and bring the signed copy to a club meeting. The Treasurer or
                President will mark you attested before you can participate in
                club activities.
              </p>
            </div>

            <form.AppForm>
              <form.SubscribeButton label="Submit for review" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
