import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { HISTORY_BODY } from "#/config/legal";
import { requirePermissionOrNotFound } from "#/features/auth/guards";
import { historyContentQueryOptions } from "#/features/history/api/queries";
import { HonoraryMembers } from "#/features/history/components/honorary-members";
import { PastOfficers } from "#/features/history/components/past-officers";

/**
 * Member-only /history page. Pairs static narrative content (founding
 * story + Steve Must memorial, owned in `legal.ts` for now — the
 * dynamic markdown migration lands in a follow-up commit) with the
 * dynamic past-officers archive + honorary-members list.
 *
 * Gated by `history:view` (auto-granted to `role_member`, so every
 * approved member sees it). Non-holders get the notFound boundary
 * rather than a redirect — deep-link to /history without permission
 * is treated as "this page is invisible to you," not "the link is
 * broken." `history:manage` is required to edit; gated separately at
 * the action layer.
 */
export const Route = createFileRoute("/history")({
  beforeLoad: async ({ context }) => {
    await requirePermissionOrNotFound(context.queryClient, "history:view");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(historyContentQueryOptions());
  },
  component: HistoryPage,
});

function HistoryPage() {
  const { data } = useSuspenseQuery(historyContentQueryOptions());

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-10 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">UCMC History</h1>
        <p className="text-sm text-muted-foreground">
          How the University of Cincinnati Mountaineering Club started, the
          people who carried it through five decades, and the friends we've lost
          along the way.
        </p>
      </header>

      <LegalSections sections={HISTORY_BODY} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Past officers</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A year-by-year archive of UCMC's elected leadership and equipment
          managers, beginning with the 1973–74 academic year. Role names and
          structures evolved over the decades — "Librarian" disappeared in the
          1980s, "Trip Coordinator" was added in the mid-2000s, "Gear
          Assistants" came in the 2010s — and the archive preserves each year's
          actual roles rather than back-fitting today's structure. Years marked
          "Unknown" reflect gaps in the historical record.
        </p>
        <PastOfficers groups={data.officersByYear} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Honorary members
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Honorary membership is granted by majority vote of the voting
          membership per Constitution §3.4, in recognition of long-running
          service to UCMC or distinguished contributions to the outdoor
          community.
        </p>
        <HonoraryMembers members={data.honoraryMembers} />
      </section>
    </main>
  );
}
