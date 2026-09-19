import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { profileQueryOptions } from "#/features/auth/api/queries";
import { BioEditor } from "#/features/auth/components/bio-editor";
import { ContactsEditor } from "#/features/auth/components/contacts-editor";
import { requireAuth } from "#/features/auth/guards";

import type { ProfileFormShape } from "#/components/profile/profile-form-shape";

/**
 * Holding page for registered-but-not-yet-approved members, and the
 * home of everything registration deliberately doesn't ask for.
 *
 * `/register/profile` collects only what an exec needs to review an
 * account. The optional parts — emergency contacts and a bio — live
 * here instead, where a member can fill them in during the wait rather
 * than on the longest form in the funnel. Both save through server fns
 * that require a session but **not** an approved account, which is what
 * makes them reachable from here at all; `/my/*` is gated on approval
 * and stays out of reach until an exec acts.
 *
 * Requires a session but not approval — that's the whole point — and
 * redirects the two states this page can't serve: an approved member
 * belongs on `/my/profile` (where the same fields sit beside everything
 * else), and a session with no profile row hasn't registered yet.
 */
export const Route = createFileRoute("/register/pending")({
  beforeLoad: async ({ context }) => {
    const principal = await requireAuth(context.queryClient);
    if (principal.status === "approved") {
      throw redirect({ to: "/my/profile" });
    }
    if (!principal.hasProfile) {
      throw redirect({ to: "/register/profile" });
    }
    return { principal };
  },
  component: PendingPage,
});

function PendingPage() {
  const { principal } = Route.useRouteContext();
  const { data, isLoading } = useQuery(profileQueryOptions());

  // Both editors take the whole shared shape and submit the siblings
  // they don't render, so they read from one snapshot of the saved
  // profile. Keying them on `updatedAt` remounts with fresh defaults
  // after a save — `useAppForm` only reads `defaultValues` on mount.
  const defaults: ProfileFormShape = data?.profile
    ? {
        ...EMPTY_PROFILE_FORM_VALUES,
        fullName: data.profile.fullName,
        preferredName: data.profile.preferredName,
        phone: data.profile.phone,
        ucAffiliation: data.profile.ucAffiliation,
        bio: data.profile.bio ?? "",
        emergencyContacts: data.emergencyContacts.map((c) => ({
          name: c.name,
          phone: c.phone,
          relationship: c.relationship,
        })),
      }
    : EMPTY_PROFILE_FORM_VALUES;
  const formKey = data?.profile?.updatedAt.toString();

  return (
    <PageContainer width="prose" className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Thanks for registering!</h1>
        <p className="text-sm text-muted-foreground">
          An exec will review <strong>{principal.primaryEmail}</strong> and
          you&rsquo;ll get an email when you&rsquo;re approved. You can close
          this tab — we won&rsquo;t hold anything up.
        </p>
      </header>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">
            While you wait{" "}
            <span className="text-sm font-normal text-muted-foreground">
              (optional)
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Neither of these holds up your review, and you can change them
            later.
          </p>
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Emergency contacts</h3>
            <p className="text-sm text-muted-foreground">
              Who UCMC should call if something happens to you on a trip. Only
              you and UCMC execs can see these.
            </p>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ContactsEditor key={`contacts-${formKey}`} defaults={defaults} />
          )}
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Bio</h3>
            <p className="text-sm text-muted-foreground">
              A short introduction other members will see in the directory once
              you&rsquo;re approved.
            </p>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <BioEditor key={`bio-${formKey}`} defaults={defaults} />
          )}
        </div>
      </section>

      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">After approval</p>
        <p className="mt-1 text-muted-foreground">
          You&rsquo;ll need to print and sign UCMC&rsquo;s{" "}
          <a
            href="/waiver"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            paper waiver of liability
          </a>{" "}
          and bring the signed copy to a club meeting. The Treasurer or
          President will mark you attested before you can participate in club
          activities.
        </p>
      </div>
    </PageContainer>
  );
}
