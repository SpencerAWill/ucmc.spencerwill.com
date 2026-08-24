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
 * Public /scholarships page. The Steve Must Memorial Scholarship —
 * how to apply, how to give, and past recipients. Body is dynamic
 * markdown stored in `markdown_pages` (slug="scholarships"); the
 * donation account number (F102341) and the UC Foundation memo line
 * inside the markdown are exact strings the Foundation's mailroom
 * uses to route the gift — confirm with the Treasurer before
 * paraphrasing them.
 */
export const Route = createFileRoute("/scholarships")({
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(
      context.queryClient,
      "scholarships",
      "public_scholarships:view",
    );
  },
  loader: async ({ context }) => {
    // The hero is prefetched alongside the page's own data rather
    // than fetched after hydration — otherwise the band paints
    // registry defaults and swaps once the query lands.
    await Promise.all([
      context.queryClient.ensureQueryData(
        markdownPageQueryOptions("scholarships"),
      ),
      context.queryClient.ensureQueryData(pageHeroQueryOptions("scholarships")),
    ]);
  },
  component: ScholarshipsPage,
});

function ScholarshipsPage() {
  const { data } = useSuspenseQuery(markdownPageQueryOptions("scholarships"));
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_scholarships:manage");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <PageHero page="scholarships" />
      <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
        {canManage ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              aria-label="Edit scholarships"
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
            slug="scholarships"
            title="Edit scholarships page"
            description="Steve Must Memorial Scholarship details. The F102341 fund identifier and the UC Foundation memo line are exact strings — verify with the Treasurer before changing them."
            open={editOpen}
            onOpenChange={setEditOpen}
            initialMarkdown={data.markdown}
            fieldLabel="Scholarships"
            placeholder="Document the scholarship program…"
          />
        ) : null}
      </main>
    </>
  );
}
