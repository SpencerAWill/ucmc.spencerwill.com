import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { PRIVACY_BODY } from "#/config/legal";

/**
 * Public privacy notice. The promises here are kept in lockstep with
 * the actual data flows by sourcing the prose from
 * `#/config/legal#PRIVACY_BODY` — when the schema, processors, or
 * retention policy change, update that constant first and treat the
 * rest of the change as a follow-on.
 */
export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="text-sm text-muted-foreground">
          What this site collects, who it's shared with, how long it's kept, and
          how to delete it.
        </p>
      </header>
      <LegalSections sections={PRIVACY_BODY} />
    </main>
  );
}
