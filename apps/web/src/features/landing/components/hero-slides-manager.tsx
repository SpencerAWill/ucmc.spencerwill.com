/**
 * Manage the list of hero slides — add, edit one in place, reorder, delete.
 * Lives inside the EditAffordance dialog. Reorder uses up/down buttons +
 * sort_order ints (no drag-and-drop in v1).
 */
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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

  async function moveSlide(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= slides.length) {
      return;
    }
    const ids = slides.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
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
        <ul className="space-y-2">
          {slides.map((slide, i) => (
            <li
              key={slide.id}
              className="flex items-center gap-3 rounded-md border bg-card p-2"
            >
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
                  onClick={() => moveSlide(i, -1)}
                  disabled={i === 0 || reorder.isPending}
                  aria-label="Move up"
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveSlide(i, 1)}
                  disabled={i === slides.length - 1 || reorder.isPending}
                  aria-label="Move down"
                >
                  <ArrowDown className="size-4" />
                </Button>
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
          ))}
        </ul>
      )}
      <Button type="button" onClick={() => setMode({ kind: "create" })}>
        <Plus className="mr-1.5 size-4" />
        Add slide
      </Button>
    </div>
  );
}
