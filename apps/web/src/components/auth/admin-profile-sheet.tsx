import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import { EmergencyContactFields } from "#/components/auth/emergency-contact-fields";
import { MNumberField } from "#/components/auth/m-number-field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useAppForm } from "#/lib/form/form";
import type { EmergencyContactInput } from "#/server/auth/server-fns";
import { PROFILE_LIMITS, profileInputSchema } from "#/server/auth/server-fns";
import { adminUpdateProfileFn } from "#/server/auth/member-fns";

type ProfileInput = z.infer<typeof profileInputSchema>;

const AFFILIATION_OPTIONS = [
  { label: "Student", value: "student" },
  { label: "Faculty", value: "faculty" },
  { label: "Staff", value: "staff" },
  { label: "Alum", value: "alum" },
  { label: "Community", value: "community" },
];

export interface AdminProfileDefaults {
  fullName: string | null;
  preferredName: string | null;
  mNumber: string | null;
  phone: string | null;
  emergencyContacts: EmergencyContactInput[];
  ucAffiliation:
    | "student"
    | "faculty"
    | "staff"
    | "alum"
    | "community"
    | ""
    | null;
}

export function AdminProfileSheet({
  userId,
  email,
  defaults,
  open,
  onOpenChange,
  detailQueryKey,
}: {
  userId: string;
  email: string;
  defaults: AdminProfileDefaults | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detailQueryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: ProfileInput) =>
      adminUpdateProfileFn({ data: { userId, ...data } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["members", "directory"],
        }),
      ]);
      onOpenChange(false);
    },
  });

  const form = useAppForm({
    defaultValues: {
      fullName: defaults?.fullName ?? "",
      preferredName: defaults?.preferredName ?? "",
      mNumber: defaults?.mNumber ?? "",
      phone: defaults?.phone ?? "",
      emergencyContacts: defaults?.emergencyContacts ?? [],
      ucAffiliation: defaults?.ucAffiliation ?? "",
    },
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>{email}</SheetDescription>
        </SheetHeader>

        <form
          className="space-y-6 px-1 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Email</Label>
            <Input
              type="email"
              value={email}
              readOnly
              className="bg-muted/40"
            />
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
            <form.AppField name="mNumber">
              {() => <MNumberField />}
            </form.AppField>
            <form.AppField name="ucAffiliation">
              {(field) => (
                <field.Select
                  label="UC affiliation"
                  placeholder="Select one..."
                  values={AFFILIATION_OPTIONS}
                />
              )}
            </form.AppField>
            <form.AppField name="phone">
              {(field) => <field.PhoneField label="Phone" />}
            </form.AppField>
          </div>

          <EmergencyContactFields form={form} />

          {mutation.isError ? (
            <p className="text-sm text-destructive">
              Couldn&rsquo;t save the profile. Please try again.
            </p>
          ) : null}

          <form.AppForm>
            <form.SubscribeButton label="Save profile" />
          </form.AppForm>
        </form>
      </SheetContent>
    </Sheet>
  );
}
