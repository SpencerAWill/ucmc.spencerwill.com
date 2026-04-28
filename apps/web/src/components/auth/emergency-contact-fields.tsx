import { Plus, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { withForm } from "#/lib/form/form";
import type { EmergencyContactInput } from "#/server/auth/server-fns";
import { PROFILE_LIMITS } from "#/server/auth/server-fns";

const RELATIONSHIP_OPTIONS = [
  { label: "Parent", value: "parent" },
  { label: "Spouse / Partner", value: "spouse_partner" },
  { label: "Sibling", value: "sibling" },
  { label: "Friend", value: "friend" },
  { label: "Other", value: "other" },
];

const EMPTY_CONTACT: EmergencyContactInput = {
  name: "",
  phone: "",
  relationship: "other",
};

/**
 * Dynamic emergency contacts section for the profile form.
 *
 * Built with TanStack Form's `withForm` pattern so the form instance is
 * received as a typed prop — `form.AppField` names are checked against
 * the `defaultValues` shape declared below.
 *
 * Must be rendered as `<EmergencyContactFields form={form} />` where
 * `form` is the `useAppForm` return value from the parent form.
 */
export const EmergencyContactFields = withForm({
  // defaultValues must match the full parent form shape for type safety.
  // Only the emergencyContacts field is rendered by this component.
  defaultValues: {
    fullName: "",
    preferredName: "",
    mNumber: "",
    phone: "",
    emergencyContacts: [] as EmergencyContactInput[],
    ucAffiliation: "" as
      | ""
      | "student"
      | "faculty"
      | "staff"
      | "alum"
      | "community",
  },
  render: function EmergencyContactFieldsRender({ form }) {
    return (
      <form.AppField name="emergencyContacts" mode="array">
        {(field) => {
          const contacts = field.state.value;

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Emergency contacts{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
              </div>

              {contacts.map((_contact, i) => (
                <div key={i} className="space-y-3">
                  {i > 0 ? <Separator /> : null}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Contact {i + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => field.removeValue(i)}
                    >
                      <Trash2 className="mr-1 size-3.5" />
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name={`emergencyContacts[${i}].name`}>
                      {(f) => (
                        <f.TextField
                          label="Name"
                          maxLength={PROFILE_LIMITS.emergencyContactName.max}
                        />
                      )}
                    </form.AppField>
                    <form.AppField name={`emergencyContacts[${i}].phone`}>
                      {(f) => <f.PhoneField label="Phone" />}
                    </form.AppField>
                    <form.AppField
                      name={`emergencyContacts[${i}].relationship`}
                    >
                      {(f) => (
                        <f.Select
                          label="Relationship"
                          placeholder="Select..."
                          values={RELATIONSHIP_OPTIONS}
                        />
                      )}
                    </form.AppField>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.pushValue({ ...EMPTY_CONTACT })}
              >
                <Plus className="mr-1.5 size-4" />
                Add emergency contact
              </Button>
            </div>
          );
        }}
      </form.AppField>
    );
  },
});
