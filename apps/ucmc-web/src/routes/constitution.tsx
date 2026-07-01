import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { CONSTITUTION_BODY } from "#/config/legal";

/**
 * Public /constitution page — UCMC's governing document, single-sourced
 * from the legacy constitution.html. Linked from the footer-driven
 * /legal index and from /about, /membership, and /policies as the
 * authoritative source for officer duties, membership classes,
 * equipment fees, and anti-hazing / non-discrimination language.
 *
 * Amendments require a two-thirds vote of the voting membership per
 * Article VIII; any future amendment that changes this page should be
 * accompanied by the corresponding vote in the meeting minutes.
 */
export const Route = createFileRoute("/constitution")({
  component: ConstitutionPage,
});

function ConstitutionPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Constitution and by-laws
        </h1>
        <p className="text-sm text-muted-foreground">
          The governing document of the University of Cincinnati Mountaineering
          Club. Amendable by two-thirds vote of the voting membership.
        </p>
      </header>
      <LegalSections sections={CONSTITUTION_BODY} />
    </main>
  );
}
