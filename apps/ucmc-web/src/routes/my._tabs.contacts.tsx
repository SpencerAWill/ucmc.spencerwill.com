import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { profileQueryOptions } from "#/features/auth/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";
import { ContactsEditor } from "#/features/auth/components/contacts-editor";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * `/my/contacts` — the member's emergency contacts, split out of the
 * Details tab onto their own page. They're the one part of a profile an
 * officer reads in an actual emergency (Bylaw 1.3 trip safety), so they
 * get a URL that can be pointed at directly instead of being buried
 * below legal name and phone.
 *
 * Same privacy class as Details: `members:view_private` only. The form
 * itself is `ContactsEditor`, shared with `/register/pending` so a
 * member awaiting approval can fill in contacts they skipped at
 * registration.
 */
export const Route = createFileRoute("/my/_tabs/contacts")({
  staticData: { pageFlag: "my_contacts" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_contacts");
  },
  component: AccountContactsPage,
});

function AccountContactsPage() {
  const { principal } = useAuth();
  const { data, isLoading } = useQuery(profileQueryOptions());

  if (!principal) {
    return null;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Emergency contacts</h2>
        <p className="text-sm text-muted-foreground">
          Who UCMC should call if something happens to you on a trip. Only you
          and UCMC execs can see these. Changes save immediately.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ContactsEditor
          key={data?.profile?.updatedAt.toString()}
          defaults={
            data?.profile
              ? {
                  ...EMPTY_PROFILE_FORM_VALUES,
                  fullName: data.profile.fullName,
                  preferredName: data.profile.preferredName,
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

      <p className="text-xs text-muted-foreground">
        Looking for your own phone number or legal name? Those live on the{" "}
        <Link to="/my/details" className="underline">
          Details
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}
