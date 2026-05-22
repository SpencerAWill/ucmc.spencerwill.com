import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useAppForm } from "#/lib/form/form";
import { MARKDOWN_PAGE_MAX } from "#/server/markdown-pages/markdown-pages-schemas";
import type { MarkdownPageSlug } from "#/server/markdown-pages/slugs";
import { useUpdateMarkdownPage } from "#/server/markdown-pages/use-update-markdown-page";

/**
 * Reusable markdown editor surface for any `markdown_pages` row.
 * Parent owns the open state + passes the slug; this component
 * fetches no data itself — the parent reads the latest body from
 * `markdownPageQueryOptions(slug)` and passes it in as
 * `initialMarkdown` so SSR-cached content is the source of truth.
 *
 * The TipTap WYSIWYG `MarkdownField` is lazy-loaded (~265 KB-gz), so
 * the editor bundle only ships once a manager opens the sheet. Read-
 * only viewers never download it.
 *
 * Gating is the parent's responsibility — render this component only
 * when the viewer holds the slug's `*:manage` permission. The server
 * action checks the same permission independently as defense-in-
 * depth, so a missing client-side gate fails closed rather than
 * silently writing.
 */
export function EditMarkdownSheet({
  slug,
  title,
  description,
  open,
  onOpenChange,
  initialMarkdown,
  fieldLabel = "Markdown",
  placeholder = "…",
  rows = 20,
}: {
  slug: MarkdownPageSlug;
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialMarkdown: string;
  fieldLabel?: string;
  placeholder?: string;
  rows?: number;
}) {
  const mutation = useUpdateMarkdownPage();
  // Bumped each time the sheet opens so `defaultValues` re-reads
  // `initialMarkdown` after a previous save updated the prop. Without
  // the key bump the form would keep showing the value from the
  // first mount.
  const [formKey, setFormKey] = useState(0);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFormKey((k) => k + 1);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>

        <MarkdownPageForm
          key={formKey}
          slug={slug}
          initialMarkdown={initialMarkdown}
          fieldLabel={fieldLabel}
          placeholder={placeholder}
          rows={rows}
          onCancel={() => onOpenChange(false)}
          onSaved={() => onOpenChange(false)}
          submitMutation={{
            isPending: mutation.isPending,
            mutateAsync: async (markdown) => {
              await mutation.mutateAsync({ slug, markdown });
            },
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function MarkdownPageForm({
  slug,
  initialMarkdown,
  fieldLabel,
  placeholder,
  rows,
  onCancel,
  onSaved,
  submitMutation,
}: {
  slug: MarkdownPageSlug;
  initialMarkdown: string;
  fieldLabel: string;
  placeholder: string;
  rows: number;
  onCancel: () => void;
  onSaved: () => void;
  submitMutation: {
    isPending: boolean;
    mutateAsync: (markdown: string) => Promise<void>;
  };
}) {
  const form = useAppForm({
    defaultValues: { markdown: initialMarkdown },
    onSubmit: async ({ value }) => {
      try {
        await submitMutation.mutateAsync(value.markdown);
        toast.success(`Saved.`);
        onSaved();
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : `Couldn't save ${slug}.`,
        );
      }
    },
  });

  return (
    <form
      className="flex flex-1 flex-col gap-4 overflow-hidden"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <form.AppField name="markdown">
          {(field) => (
            <field.MarkdownField
              label={fieldLabel}
              rows={rows}
              placeholder={placeholder}
              maxLength={MARKDOWN_PAGE_MAX}
            />
          )}
        </form.AppField>
      </div>

      <SheetFooter className="border-t">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitMutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}
