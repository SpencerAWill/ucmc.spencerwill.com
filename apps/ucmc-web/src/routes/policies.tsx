import { useSuspenseQuery } from "@tanstack/react-query";
import { pageHeroQueryOptions } from "#/features/landing/api/queries";
import { PageHero } from "#/features/landing/components/page-hero";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { EditMarkdownSheet } from "#/components/markdown/edit-markdown-sheet";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePageEnabled } from "#/features/settings/api/page-guards";
import { markdownPageQueryOptions } from "#/server/markdown-pages/queries";

/**
 * Public /policies page. Consolidates the legacy ucmc-gear-policy,
 * whitewater-policy, and climbing-policy pages into a single
 * markdown surface — operational rules for gear checkout, whitewater
 * participation, and climbing participation.
 *
 * Distinct from /legal (which lists site/legal compliance pages like
 * the registration disclaimer and waiver) — these are *club*
 * operational policies that change with the seasons. Editable at
 * runtime by holders of `public_policies:manage`; view-gated by
 * `public_policies:view` (default-granted to anonymous viewers so
 * the page stays publicly readable).
 */
export const Route = createFileRoute("/policies")({
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(
      context.queryClient,
      "policies",
      "public_policies:view",
    );
  },
  loader: async ({ context }) => {
    // The hero is prefetched alongside the page's own data rather than
    // fetched after hydration — otherwise the band paints registry
    // defaults and swaps once the query lands.
    await Promise.all([
      context.queryClient.ensureQueryData(markdownPageQueryOptions("policies")),
      context.queryClient.ensureQueryData(pageHeroQueryOptions("policies")),
    ]);
  },
  component: PoliciesPage,
});

function PoliciesPage() {
  const { data } = useSuspenseQuery(markdownPageQueryOptions("policies"));
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_policies:manage");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <PageHero page="policies" />
      <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
        {canManage ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              aria-label="Edit policies"
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          </div>
        ) : null}

        {data.markdown.length > 0 ? (
          <MarkdownContent>{data.markdown}</MarkdownContent>
        ) : null}

        {canManage ? (
          <EditMarkdownSheet
            slug="policies"
            title="Edit club policies"
            description="Skill tiers, gear checkout requirements, fines. Renders as markdown — use ## for section headings, - for bullet lists."
            open={editOpen}
            onOpenChange={setEditOpen}
            initialMarkdown={data.markdown}
            fieldLabel="Policies"
            placeholder="Document the club's operational rules…"
          />
        ) : null}
      </main>
    </>
  );
}
