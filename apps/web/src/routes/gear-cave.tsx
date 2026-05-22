import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { GEAR_CAVE_BODY } from "#/config/legal";

/**
 * Public /gear-cave page. Prospective-member view of UCMC's gear-cave
 * service: what we own at a category level, how to qualify to borrow,
 * and how the standard Wed-to-Wed checkout cycle works. Distinct from
 * the auth'd /gear inventory (per-piece detail, live availability,
 * loans desk) which stays members-only.
 *
 * Consolidates the legacy equipment.html and the public summary of
 * gear-list.html.
 */
export const Route = createFileRoute("/gear-cave")({
  component: GearCavePage,
});

function GearCavePage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">The Gear Cave</h1>
        <p className="text-sm text-muted-foreground">
          UCMC's communal equipment library — what we own, how to borrow, and
          what it costs.
        </p>
      </header>
      <LegalSections sections={GEAR_CAVE_BODY} />
    </main>
  );
}
