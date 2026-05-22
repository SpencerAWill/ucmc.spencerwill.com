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
import { useUpdateHistoryNarrative } from "#/features/history/api/use-update-narrative";
import { NARRATIVE_MAX } from "#/features/history/server/history-schemas";
import { useAppForm } from "#/lib/form/form";

/**
 * `history:manage`-gated editor for the /history narrative markdown.
 * Renders nothing of its own — exposed as a controlled Sheet so the
 * parent /history page controls open state from the Edit button.
 *
 * Wraps a one-field form so the TipTap WYSIWYG MarkdownField (lazy-
 * loaded, ~265 KB-gz) doesn't ship to readers — only mounts when a
 * manager actually opens the sheet.
 */
export function EditNarrativeSheet({
  open,
  onOpenChange,
  initialMarkdown,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialMarkdown: string;
}) {
  const mutation = useUpdateHistoryNarrative();
  // Bumped each time the sheet opens; passed into useAppForm's `key`
  // so the form's `defaultValues` re-reads `initialMarkdown` after a
  // previous save updates the prop. Otherwise the form would keep
  // showing the value from the first mount.
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
          <SheetTitle>Edit history narrative</SheetTitle>
          <SheetDescription>
            The founding story, decades-of-camaraderie overview, and Steve Must
            memorial. Renders as markdown — headings (##), bold, italic, links,
            and lists are all supported.
          </SheetDescription>
        </SheetHeader>

        <NarrativeForm
          key={formKey}
          initialMarkdown={initialMarkdown}
          onCancel={() => onOpenChange(false)}
          onSaved={() => onOpenChange(false)}
          submitMutation={{
            isPending: mutation.isPending,
            mutateAsync: async (markdown) => {
              await mutation.mutateAsync({ markdown });
            },
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function NarrativeForm({
  initialMarkdown,
  onCancel,
  onSaved,
  submitMutation,
}: {
  initialMarkdown: string;
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
        toast.success("History narrative saved.");
        onSaved();
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't save the narrative.",
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
              label="Narrative"
              rows={20}
              placeholder="Tell the club's story…"
              maxLength={NARRATIVE_MAX}
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
