import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { RESOURCES_BODY } from "#/config/legal";

/**
 * Public /resources hub. Consolidates the legacy plan-a-trip, forms,
 * gear-suggestions (whitewater + caving), resources, useful-links,
 * and programs pages — trip-planning PDFs, packing guides, UC student
 * support contacts, external training organizations, and a curated
 * subset of regional outdoor links.
 */
export const Route = createFileRoute("/resources")({
  component: ResourcesPage,
});

function ResourcesPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
        <p className="text-sm text-muted-foreground">
          Trip-planning paperwork, packing guides, UC student support contacts,
          external training organizations, and a curated set of outdoor links.
        </p>
      </header>
      <LegalSections sections={RESOURCES_BODY} />
    </main>
  );
}
