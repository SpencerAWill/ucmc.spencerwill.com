import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { z } from "zod";

import { MNumberField } from "#/components/auth/m-number-field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SESSION_QUERY_KEY } from "#/lib/auth/use-auth";
import { useAppForm } from "#/lib/form/form";
import {
  PROFILE_LIMITS,
  profileInputSchema,
  submitProfileFn,
} from "#/server/auth/server-fns";

type ProfileInput = z.infer<typeof profileInputSchema>;

const AFFILIATION_OPTIONS = [
  { label: "Student", value: "student" },
  { label: "Faculty", value: "faculty" },
  { label: "Staff", value: "staff" },
  { label: "Alum", value: "alum" },
  { label: "Community", value: "community" },
];

export interface ProfileFormDefaults {
  fullName?: string;
  preferredName?: string;
  mNumber?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  ucAffiliation?: "student" | "faculty" | "staff" | "alum" | "community" | "";
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (data: ProfileInput) => submitProfileFn({ data }),
    onSuccess: async () => {
      // Session just opened (or was re-affirmed) server-side; refetch the
      // principal before navigating so the destination guard sees the
      // new state. Also invalidate the cached profile row so the
      // /account tab re-reads the saved values on next render.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["account", "profile"] }),
      ]);
      await navigate({ to: redirectTo });
    },
  });

  const form = useAppForm({
    defaultValues: {
      fullName: defaults?.fullName ?? "",
      preferredName: defaults?.preferredName ?? "",
      mNumber: defaults?.mNumber ?? "",
      phone: defaults?.phone ?? "",
      emergencyContactName: defaults?.emergencyContactName ?? "",
      emergencyContactPhone: defaults?.emergencyContactPhone ?? "",
      ucAffiliation: defaults?.ucAffiliation ?? "",
    },
    // onMount runs the schema once on load so `canSubmit` starts false
    // (empty required fields are invalid). No field is `isTouched` yet
    // so no red indicators appear — just the button stays disabled.
    // onBlur establishes the first visible validation per field;
    // onChange re-runs on every keystroke so invalid → valid transitions
    // flip red to green immediately. onSubmit is the final gate.
    validators: {
      onMount: profileInputSchema,
      onChange: profileInputSchema,
      onBlur: profileInputSchema,
      onSubmit: profileInputSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(value as ProfileInput);
    },
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="profile-email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="profile-email"
          type="email"
          value={email}
          readOnly
          // Rendered in the form so a reviewer/autofill context knows
          // whose profile this is, but editing the email means
          // re-verifying via magic link — not a field-level change.
          aria-describedby="profile-email-hint"
          className="bg-muted/40"
        />
        <p id="profile-email-hint" className="text-xs text-muted-foreground">
          To change your email, sign out and re-register with the new address.
        </p>
      </div>
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
        <form.AppField name="preferredName">
          {(field) => (
            <field.TextField
              label="Preferred name"
              autoComplete="nickname"
              maxLength={PROFILE_LIMITS.preferredName.max}
            />
          )}
        </form.AppField>
        <form.AppField name="mNumber">{() => <MNumberField />}</form.AppField>
        <form.AppField name="ucAffiliation">
          {(field) => (
            <field.Select
              label="UC affiliation"
              placeholder="Select one…"
              values={AFFILIATION_OPTIONS}
            />
          )}
        </form.AppField>
        <form.AppField name="phone">
          {(field) => <field.PhoneField label="Phone" />}
        </form.AppField>
        <div />
        <form.AppField name="emergencyContactName">
          {(field) => (
            <field.TextField
              label="Emergency contact name"
              maxLength={PROFILE_LIMITS.emergencyContactName.max}
            />
          )}
        </form.AppField>
        <form.AppField name="emergencyContactPhone">
          {(field) => <field.PhoneField label="Emergency contact phone" />}
        </form.AppField>
      </div>

      {mutation.isError ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t save your profile. Please try again.
        </p>
      ) : null}

      <form.AppForm>
        <form.SubscribeButton label="Submit for review" />
      </form.AppForm>
    </form>
  );
}
