import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { SCHOLARSHIPS_BODY } from "#/config/legal";

/**
 * Public /scholarships page. Consolidates the legacy
 * scholarships.html, earn-it.html, committee.html, contribute.html,
 * and experiences.html into one config-driven surface so a prospective
 * applicant can read the rules, the timeline, and how to give in one
 * scroll.
 *
 * The donation account number (F102341) and the UC Foundation memo
 * line are exact strings — the Foundation's mailroom uses them to
 * route the gift to the right fund.
 */
export const Route = createFileRoute("/scholarships")({
  component: ScholarshipsPage,
});

function ScholarshipsPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Scholarships</h1>
        <p className="text-sm text-muted-foreground">
          The Steve Must Memorial Scholarship: how to apply, how to give, and
          who's received it over the years.
        </p>
      </header>
      <LegalSections sections={SCHOLARSHIPS_BODY} />
    </main>
  );
}
