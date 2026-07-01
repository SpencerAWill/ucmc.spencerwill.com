/**
 * Manage the list of hero slides — add, edit one in place, reorder, delete.
 * Lives inside the EditAffordance dialog. Reorder uses drag-and-drop.
 */
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SortableItem, SortableList } from "#/components/sortable-list";
import { Button } from "#/components/ui/button";
import { useDeleteHeroSlide } from "#/features/landing/api/use-delete-hero-slide";
import { useReorderHeroSlides } from "#/features/landing/api/use-reorder-hero-slides";
import { HeroSlideEditor } from "#/features/landing/components/hero-slide-editor";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import type { HeroSlideSummary } from "#/features/landing/server/landing-fns";

export interface HeroSlidesManagerProps {
  slides: HeroSlideSummary[];
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; slide: HeroSlideSummary };

export function HeroSlidesManager({ slides }: HeroSlidesManagerProps) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const reorder = useReorderHeroSlides();
  const remove = useDeleteHeroSlide();

  async function applyReorder(ids: string[]) {
    try {
      await reorder.mutateAsync({ ids });
    } catch {
      toast.error("Couldn’t reorder slides.");
    }
  }

  async function deleteSlide(id: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete this slide? The image will be removed permanently.",
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync({ id });
      toast.success("Slide deleted");
    } catch {
      toast.error("Couldn’t delete the slide.");
    }
  }

  if (mode.kind === "create") {
    return (
      <HeroSlideEditor
        onSaved={() => setMode({ kind: "list" })}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "edit") {
    return (
      <HeroSlideEditor
        slide={mode.slide}
        onSaved={() => setMode({ kind: "list" })}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div className="space-y-4">
      {slides.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No slides yet. Add your first one to start the gallery.
        </p>
      ) : (
        <SortableList
          ids={slides.map((s) => s.id)}
          onReorder={applyReorder}
          disabled={reorder.isPending}
        >
          <ul className="space-y-2">
            {slides.map((slide) => (
              <SortableItem key={slide.id} id={slide.id}>
                {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                  <li
                    ref={setNodeRef}
                    style={style}
                    className={`flex items-center gap-3 rounded-md border bg-card p-2 ${
                      isDragging ? "shadow-md" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                      aria-label="Drag to reorder"
                      {...attributes}
                      {...listeners}
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <div className="aspect-[16/9] w-32 shrink-0 overflow-hidden rounded">
                      <img
                        src={landingImageUrlFor(slide.imageKey)}
                        alt={slide.alt}
                        className="size-full object-cover"
                      />
                    </div>
                    <p className="flex-1 truncate text-sm">{slide.alt}</p>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setMode({ kind: "edit", slide })}
                        aria-label="Edit slide"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteSlide(slide.id)}
                        disabled={remove.isPending}
                        aria-label="Delete slide"
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
      <Button type="button" onClick={() => setMode({ kind: "create" })}>
        <Plus className="mr-1.5 size-4" />
        Add slide
      </Button>
    </div>
  );
}
