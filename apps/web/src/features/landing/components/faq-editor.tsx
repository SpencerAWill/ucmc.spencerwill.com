import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SortableItem, SortableList } from "#/components/sortable-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useCreateFaqItem } from "#/features/landing/api/use-create-faq-item";
import { useDeleteFaqItem } from "#/features/landing/api/use-delete-faq-item";
import { useReorderFaqItems } from "#/features/landing/api/use-reorder-faq-items";
import { useUpdateFaqItem } from "#/features/landing/api/use-update-faq-item";
import { noPasswordManagerProps } from "#/features/landing/lib/no-password-manager";
import type { FaqItemSummary } from "#/features/landing/server/landing-fns";
import { LANDING_LIMITS } from "#/features/landing/server/landing-schemas";

export interface FaqEditorProps {
  items: FaqItemSummary[];
  onSaved: () => void;
  onCancel: () => void;
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; item: FaqItemSummary };

export function FaqEditor({ items, onSaved, onCancel }: FaqEditorProps) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const create = useCreateFaqItem();
  const update = useUpdateFaqItem();
  const remove = useDeleteFaqItem();
  const reorder = useReorderFaqItems();

  async function applyReorder(ids: string[]) {
    try {
      await reorder.mutateAsync({ ids });
    } catch {
      toast.error("Couldn’t reorder.");
    }
  }

  async function deleteItem(id: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this FAQ item?")
    ) {
      return;
    }
    try {
      await remove.mutateAsync({ id });
      toast.success("Deleted");
    } catch {
      toast.error("Couldn’t delete.");
    }
  }

  if (mode.kind === "create") {
    return (
      <FaqItemForm
        onSubmit={async (data) => {
          await create.mutateAsync(data);
          toast.success("FAQ added");
          setMode({ kind: "list" });
        }}
        onCancel={() => setMode({ kind: "list" })}
        busy={create.isPending}
      />
    );
  }

  if (mode.kind === "edit") {
    return (
      <FaqItemForm
        initial={mode.item}
        onSubmit={async (data) => {
          await update.mutateAsync({ id: mode.item.id, ...data });
          toast.success("FAQ updated");
          setMode({ kind: "list" });
        }}
        onCancel={() => setMode({ kind: "list" })}
        busy={update.isPending}
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No FAQ items yet.
        </p>
      ) : (
        <SortableList
          ids={items.map((it) => it.id)}
          onReorder={applyReorder}
          disabled={reorder.isPending}
        >
          <ul className="space-y-2">
            {items.map((item) => (
              <SortableItem key={item.id} id={item.id}>
                {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                  <li
                    ref={setNodeRef}
                    style={style}
                    className={`flex items-start gap-2 rounded-md border bg-card p-3 ${
                      isDragging ? "shadow-md" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="mt-0.5 flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                      aria-label="Drag to reorder"
                      {...attributes}
                      {...listeners}
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.question}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {item.answer}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setMode({ kind: "edit", item })}
                        aria-label="Edit"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteItem(item.id)}
                        disabled={remove.isPending}
                        aria-label="Delete"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                )}
              </SortableItem>
            ))}
          </ul>
        </SortableList>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          onClick={() => setMode({ kind: "create" })}
          disabled={items.length >= LANDING_LIMITS.faqItemCount.max}
        >
          <Plus className="mr-1.5 size-4" />
          Add item
        </Button>
        <Button type="button" variant="ghost" onClick={onSaved}>
          Done
        </Button>
      </div>
      {items.length >= LANDING_LIMITS.faqItemCount.max ? (
        <p className="text-xs text-muted-foreground">
          Maximum {LANDING_LIMITS.faqItemCount.max} FAQ items reached.
        </p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="hidden"
        onClick={onCancel}
      />
    </div>
  );
}

function FaqItemForm({
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  initial?: FaqItemSummary;
  onSubmit: (data: { question: string; answer: string }) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");

  async function submit() {
    const q = question.trim();
    const a = answer.trim();
    if (q.length === 0 || a.length === 0) {
      toast.error("Question and answer are required.");
      return;
    }
    try {
      await onSubmit({ question: q, answer: a });
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : "Couldn’t save.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="faq-q">Question</Label>
        <Input
          id="faq-q"
          value={question}
          maxLength={LANDING_LIMITS.faqQuestion.max}
          onChange={(e) => setQuestion(e.target.value)}
          {...noPasswordManagerProps}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="faq-a">Answer</Label>
        <Textarea
          id="faq-a"
          value={answer}
          maxLength={LANDING_LIMITS.faqAnswer.max}
          onChange={(e) => setAnswer(e.target.value)}
          rows={5}
          {...noPasswordManagerProps}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
