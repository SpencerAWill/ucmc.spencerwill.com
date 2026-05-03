import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { MEMBERSHIP_BODY } from "#/config/legal";

/**
 * Public membership / eligibility / dues / how-to-join page. The
 * verification-not-gatekeeping framing of the registration approval
 * queue lives here, mirroring the constitutional invariant from
 * Article III §3.2.
 */
export const Route = createFileRoute("/membership")({
  component: MembershipPage,
});

function MembershipPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Membership</h1>
        <p className="text-sm text-muted-foreground">
          Who can join, how dues work, and what the registration approval queue
          actually checks.
        </p>
      </header>
      <LegalSections sections={MEMBERSHIP_BODY} />
    </main>
  );
}
