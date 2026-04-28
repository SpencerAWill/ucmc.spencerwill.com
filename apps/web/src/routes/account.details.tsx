import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmergencyContactFields } from "#/components/profile/emergency-contact-fields";
import { PrivateDetailFields } from "#/components/profile/private-detail-fields";
import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useAuth } from "#/features/auth/api/use-auth";
import { useAppForm } from "#/lib/form/form";
import { useUnsavedChangesGuard } from "#/lib/form/use-unsaved-changes-guard";
import {
  getProfileFn,
  submitDetailsFn,
} from "#/features/auth/server/server-fns";
import { profileInputSchema } from "#/server/profile/profile-schemas";
import type { DetailsInput } from "#/server/profile/profile-schemas";

import { ACCOUNT_PROFILE_QUERY_KEY } from "./account.index";

/**
 * `/account/details` — private profile fields (legal name, M-number,
 * phone) plus emergency contacts. Mirrors the server-side
 * `members:view_private` projection: only the user themselves and
 * admins ever see these values.
 */
export const Route = createFileRoute("/account/details")({
  component: AccountDetailsPage,
});

function AccountDetailsPage() {
  const { principal } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ACCOUNT_PROFILE_QUERY_KEY,
    queryFn: () => getProfileFn(),
    staleTime: 30_000,
  });

  if (!principal) {
    return null;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Details</h2>
        <p className="text-sm text-muted-foreground">
          Private information only you and UCMC execs can see. Changes save
          immediately.
        </p>
      </header>

      <div className="space-y-1.5">
        <Label htmlFor="details-email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="details-email"
          type="email"
          value={principal.email}
          readOnly
          aria-describedby="details-email-hint"
          className="bg-muted/40"
        />
        <p id="details-email-hint" className="text-xs text-muted-foreground">
          To change your email, sign out and re-register with the new address.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DetailsEditor
          key={data?.profile?.updatedAt.toString()}
          defaults={
            data?.profile
              ? {
                  ...EMPTY_PROFILE_FORM_VALUES,
                  fullName: data.profile.fullName,
                  preferredName: data.profile.preferredName,
                  mNumber: data.profile.mNumber,
                  phone: data.profile.phone,
                  ucAffiliation: data.profile.ucAffiliation,
                  emergencyContacts: data.emergencyContacts.map((c) => ({
                    name: c.name,
                    phone: c.phone,
                    relationship: c.relationship,
                  })),
                }
              : EMPTY_PROFILE_FORM_VALUES
          }
        />
      )}
    </div>
  );
}

function DetailsEditor({ defaults }: { defaults: ProfileFormShape }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: DetailsInput) => submitDetailsFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ACCOUNT_PROFILE_QUERY_KEY,
      });
      toast.success("Details saved");
      // See profile-form.tsx for why this synchronous reset is needed.
      form.reset(form.state.values);
    },
    onError: () => {
      toast.error("Couldn’t save your details. Please try again.");
    },
  });

  // Same full-form validation pattern as the Profile tab — see comment
  // there. The form holds every profile field (populated from saved
  // values), but only the Details fields below are editable. Submit
  // picks just the private columns and calls `submitDetailsFn`.
  const form = useAppForm({
    defaultValues: defaults,
    validators: {
      onMount: profileInputSchema,
      onChange: profileInputSchema,
      onBlur: profileInputSchema,
      onSubmit: profileInputSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate({
        fullName: value.fullName,
        mNumber: value.mNumber,
        phone: value.phone,
        emergencyContacts: value.emergencyContacts,
      } as DetailsInput);
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
            <PrivateDetailFields form={form} />
            <EmergencyContactFields form={form} />
            <form.AppForm>
              <form.SubscribeButton label="Save changes" />
            </form.AppForm>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
