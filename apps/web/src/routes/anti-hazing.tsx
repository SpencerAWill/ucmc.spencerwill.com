import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { ANTI_HAZING_BODY } from "#/config/legal";

/**
 * Public anti-hazing statement. Mirrors Constitution Art XII and links
 * UC's reporting channels. Collin's Law (ORC §2903.311) creates a
 * mandatory-reporting obligation for officers acting in an official
 * capacity, surfaced here so members and officers can find the report
 * form quickly.
 */
export const Route = createFileRoute("/anti-hazing")({
  component: AntiHazingPage,
});

function AntiHazingPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Anti-hazing</h1>
        <p className="text-sm text-muted-foreground">
          UCMC's commitment under Article XII of our constitution and Ohio
          Revised Code §2903.311 (Collin's Law).
        </p>
      </header>
      <LegalSections sections={ANTI_HAZING_BODY} />
    </main>
  );
}
