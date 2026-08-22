import { useSuspenseQuery } from "@tanstack/react-query";
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
    await context.queryClient.ensureQueryData(
      markdownPageQueryOptions("policies"),
    );
  },
  component: PoliciesPage,
});

function PoliciesPage() {
  const { data } = useSuspenseQuery(markdownPageQueryOptions("policies"));
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_policies:manage");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Club policies
          </h1>
          <p className="text-sm text-muted-foreground">
            Operational rules for gear checkout, whitewater participation, and
            climbing participation. Read these before your first trip or first
            checkout.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label="Edit policies"
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        ) : null}
      </header>

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
  );
}
