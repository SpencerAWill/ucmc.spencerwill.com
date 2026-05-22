import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "#/components/ui/button";
import { galleryImageUrl } from "#/features/gallery/lib/image-url";
import type { GalleryPhotoSummary } from "#/features/gallery/server/gallery-fns";
import { cn } from "#/lib/utils";

/**
 * Click-to-zoom modal for the Trip Gallery grid. Built directly on
 * Radix Dialog (rather than the shadcn `<Dialog>` wrapper) so the
 * content surface can render full-bleed without the wrapper's
 * default padding + close-button — we want the photo to dominate
 * the viewport.
 *
 * Keyboard:
 *   - ← / → navigate to the previous / next photo in the visible
 *     list (the same list the grid renders, so prev/next traverse
 *     the current filter rather than the full archive).
 *   - Esc closes (Radix native).
 *
 * Open state is fully controlled by the parent: pass the active
 * photo's `publicId` and the `photos` array. `null` closes. The
 * URL search param `?photo=$publicId` is the source of truth; the
 * parent route's `Route.useSearch()` drives this.
 */
export function PhotoLightbox({
  photos,
  activePublicId,
  onClose,
  onChange,
}: {
  photos: GalleryPhotoSummary[];
  activePublicId: string | null;
  onClose: () => void;
  /** Called when the user navigates to a different photo (← / →). */
  onChange: (publicId: string) => void;
}) {
  const activeIndex = activePublicId
    ? photos.findIndex((p) => p.publicId === activePublicId)
    : -1;
  const active = activeIndex >= 0 ? photos[activeIndex] : null;
  const isOpen = active !== null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        if (activeIndex > 0) {
          event.preventDefault();
          onChange(photos[activeIndex - 1].publicId);
        }
      } else if (event.key === "ArrowRight") {
        if (activeIndex < photos.length - 1) {
          event.preventDefault();
          onChange(photos[activeIndex + 1].publicId);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, activeIndex, photos, onChange]);

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/85 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {active?.caption ?? active?.altText ?? "Gallery photo"}
          </DialogPrimitive.Title>

          {/* Top bar: counter + close */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-white">
            <span>
              {activeIndex + 1} / {photos.length}
            </span>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="size-5" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Image area with prev/next overlays */}
          <div className="relative flex flex-1 items-center justify-center px-4">
            {active ? (
              <img
                src={galleryImageUrl(active.imageKey)}
                alt={active.altText}
                width={active.widthPx}
                height={active.heightPx}
                className="max-h-full max-w-full object-contain"
              />
            ) : null}

            {activeIndex > 0 ? (
              <button
                type="button"
                onClick={() => onChange(photos[activeIndex - 1].publicId)}
                className="absolute left-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-6" />
              </button>
            ) : null}
            {activeIndex < photos.length - 1 ? (
              <button
                type="button"
                onClick={() => onChange(photos[activeIndex + 1].publicId)}
                className="absolute right-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                aria-label="Next photo"
              >
                <ChevronRight className="size-6" />
              </button>
            ) : null}
          </div>

          {/* Caption + metadata strip */}
          {active ? (
            <div className="space-y-1 px-4 py-3 text-sm text-white">
              {active.caption ? (
                <p className="font-medium">{active.caption}</p>
              ) : null}
              <p className="text-xs text-white/70">
                {active.credit ? `Photo by ${active.credit}` : null}
                {active.credit && active.tag ? " · " : null}
                {active.tag}
              </p>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
