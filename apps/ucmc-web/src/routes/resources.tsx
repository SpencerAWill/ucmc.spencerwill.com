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
 * Public /resources hub. Trip-planning paperwork, packing guides,
 * UC student support contacts, external training organizations, and
 * a curated subset of regional outdoor links.
 *
 * Body is dynamic markdown stored in `markdown_pages`
 * (slug="resources"); view gated by `public_resources:view`, manage
 * by `public_resources:manage`. The re-hosted PDFs under
 * /resources/*.pdf are referenced from inside the markdown — links
 * to those static assets keep working regardless of the markdown
 * body since they're served by Cloudflare Pages, not the worker.
 */
export const Route = createFileRoute("/resources")({
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(
      context.queryClient,
      "resources",
      "public_resources:view",
    );
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      markdownPageQueryOptions("resources"),
    );
  },
  component: ResourcesPage,
});

function ResourcesPage() {
  const { data } = useSuspenseQuery(markdownPageQueryOptions("resources"));
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_resources:manage");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
          <p className="text-sm text-muted-foreground">
            Trip-planning paperwork, packing guides, UC student support
            contacts, external training organizations, and a curated set of
            outdoor links.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label="Edit resources"
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
          slug="resources"
          title="Edit resources page"
          description="Trip-planning paperwork, packing guides, UC student support, training orgs, and outdoor links. Re-hosted PDFs live at /resources/*.pdf — keep those exact paths working."
          open={editOpen}
          onOpenChange={setEditOpen}
          initialMarkdown={data.markdown}
          fieldLabel="Resources"
          placeholder="Curate the trip-planning hub…"
        />
      ) : null}
    </main>
  );
}
