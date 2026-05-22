import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { EditMarkdownSheet } from "#/components/markdown/edit-markdown-sheet";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { requireViewPermission } from "#/features/auth/guards";
import { markdownPageQueryOptions } from "#/server/markdown-pages/queries";

/**
 * Public /gear-cave page. Prospective-member view of UCMC's gear-
 * cave service: what we own at a category level, how to qualify to
 * borrow, and how the standard Wed-to-Wed checkout cycle works.
 * Distinct from the auth'd /gear inventory (per-piece detail, live
 * availability, loans desk) which stays members-only.
 *
 * Body is dynamic markdown stored in `markdown_pages`
 * (slug="gear_cave"); view gated by `public_gear_cave:view`, manage
 * by `public_gear_cave:manage`.
 */
export const Route = createFileRoute("/gear-cave")({
  beforeLoad: async ({ context }) => {
    await requireViewPermission(context.queryClient, "public_gear_cave:view");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      markdownPageQueryOptions("gear_cave"),
    );
  },
  component: GearCavePage,
});

function GearCavePage() {
  const { data } = useSuspenseQuery(markdownPageQueryOptions("gear_cave"));
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_gear_cave:manage");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            The Gear Cave
          </h1>
          <p className="text-sm text-muted-foreground">
            UCMC's communal equipment library — what we own, how to borrow, and
            what it costs.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label="Edit gear-cave page"
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
          slug="gear_cave"
          title="Edit gear-cave page"
          description="The prospective-member overview of the gear library. Per-piece detail and live availability stay on the auth'd /gear inventory — this page is the public face."
          open={editOpen}
          onOpenChange={setEditOpen}
          initialMarkdown={data.markdown}
          fieldLabel="Gear cave"
          placeholder="Describe the gear-cave service…"
        />
      ) : null}
    </main>
  );
}
