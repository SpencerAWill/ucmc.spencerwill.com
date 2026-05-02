import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { TERMS_BODY } from "#/config/legal";

/**
 * Public terms of use for the website itself. Distinct from the
 * waiver (which covers club activities) — these terms cover use of
 * the member portal at ucmc.spencerwill.com.
 */
export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Terms of use</h1>
        <p className="text-sm text-muted-foreground">
          Acceptable use of this website. Distinct from the UCMC Waiver of
          Liability, which covers club activities.
        </p>
      </header>
      <LegalSections sections={TERMS_BODY} />
    </main>
  );
}
