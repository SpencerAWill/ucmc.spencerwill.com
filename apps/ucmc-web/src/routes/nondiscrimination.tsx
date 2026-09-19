import { createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { LegalSections } from "#/components/legal/legal-section";
import { NON_DISCRIMINATION_BODY } from "#/config/legal";

/**
 * Public non-discrimination statement. Mirrors UC's Notice of
 * Non-Discrimination, references Ohio SB 1 (2025), and references the
 * UC CAMPUS Act Policy + EO 2022-06D antisemitism definition.
 */
export const Route = createFileRoute("/nondiscrimination")({
  component: NonDiscriminationPage,
});

function NonDiscriminationPage() {
  return (
    <PageContainer width="prose" className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Non-discrimination
        </h1>
        <p className="text-sm text-muted-foreground">
          UCMC's commitment under federal law, Ohio SB 1 (2025), and the UC
          CAMPUS Act Policy.
        </p>
      </header>
      <LegalSections sections={NON_DISCRIMINATION_BODY} />
    </PageContainer>
  );
}
