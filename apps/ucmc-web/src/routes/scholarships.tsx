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
    await context.queryClient.ensureQueryData(
      markdownPageQueryOptions("scholarships"),
    );
  },
  component: ScholarshipsPage,
});

function ScholarshipsPage() {
  const { data } = useSuspenseQuery(markdownPageQueryOptions("scholarships"));
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_scholarships:manage");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Scholarships
          </h1>
          <p className="text-sm text-muted-foreground">
            The Steve Must Memorial Scholarship: how to apply, how to give, and
            who's received it over the years.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label="Edit scholarships"
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
  );
}
