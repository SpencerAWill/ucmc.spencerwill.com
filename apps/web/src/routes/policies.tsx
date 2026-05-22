import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { POLICIES_BODY } from "#/config/legal";

/**
 * Public /policies page. Consolidates the legacy ucmc-gear-policy,
 * whitewater-policy, and climbing-policy pages into a single
 * config-driven surface so a prospective trip participant can read
 * the operational rules — skill tiers, gear checkout requirements,
 * fine schedule — without an account.
 *
 * Distinct from /legal (which lists site/legal compliance pages like
 * the registration disclaimer and waiver) — these are *club*
 * operational policies that change with the seasons.
 */
export const Route = createFileRoute("/policies")({
  component: PoliciesPage,
});

function PoliciesPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Club policies</h1>
        <p className="text-sm text-muted-foreground">
          Operational rules for gear checkout, whitewater participation, and
          climbing participation. Read these before your first trip or first
          checkout.
        </p>
      </header>
      <LegalSections sections={POLICIES_BODY} />
    </main>
  );
}
