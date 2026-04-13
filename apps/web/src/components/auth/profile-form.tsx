import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { z } from "zod";

import { useAppForm } from "#/lib/form/form";
import { profileInputSchema, submitProfileFn } from "#/server/auth/server-fns";
import { SESSION_QUERY_KEY } from "#/lib/auth/use-auth";

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
  defaults,
  redirectTo = "/register/pending",
}: {
  defaults?: ProfileFormDefaults;
  redirectTo?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (data: ProfileInput) => submitProfileFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
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
    validators: { onSubmit: profileInputSchema },
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
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="fullName">
          {(field) => <field.TextField label="Full name" autoComplete="name" />}
        </form.AppField>
        <form.AppField name="preferredName">
          {(field) => (
            <field.TextField label="Preferred name" autoComplete="nickname" />
          )}
        </form.AppField>
        <form.AppField name="mNumber">
          {(field) => (
            <field.TextField label="M-number" placeholder="M12345678" />
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
        <form.AppField name="phone">
          {(field) => (
            <field.TextField label="Phone" autoComplete="tel" type="tel" />
          )}
        </form.AppField>
        <div />
        <form.AppField name="emergencyContactName">
          {(field) => <field.TextField label="Emergency contact name" />}
        </form.AppField>
        <form.AppField name="emergencyContactPhone">
          {(field) => (
            <field.TextField label="Emergency contact phone" type="tel" />
          )}
        </form.AppField>
      </div>

      {mutation.isError && (
        <p className="text-destructive text-sm">
          Couldn’t save your profile. Please try again.
        </p>
      )}

      <form.AppForm>
        <form.SubscribeButton label="Submit for review" />
      </form.AppForm>
    </form>
  );
}
