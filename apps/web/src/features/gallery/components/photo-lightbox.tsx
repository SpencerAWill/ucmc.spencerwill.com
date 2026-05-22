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
 * content surface can render with our own padding / chrome instead
 * of the wrapper's stock dialog shell.
 *
 * Layout: dark backdrop fills the viewport; the lightbox itself is
 * a centered card with `p-4 sm:p-8` of breathing room. The image
 * area uses `flex-1 min-h-0` so the `<img>` actually shrinks to fit
 * the flex parent (without `min-h-0`, a flex item's default
 * `min-height: auto` honors the image's intrinsic 1600×1200 and
 * overflows the viewport).
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
          className="fixed inset-0 z-50 flex flex-col p-3 sm:p-6"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            {active?.caption ?? active?.altText ?? "Gallery photo"}
          </DialogPrimitive.Title>

          {/* Top bar: counter + close */}
          <div className="flex shrink-0 items-center justify-between gap-4 pb-3 text-sm text-white">
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

          {/*
            Image area. `min-h-0` is load-bearing: without it the
            flex item's default `min-height: auto` honors the
            image's intrinsic 1600×1200 and the photo overflows the
            viewport. `min-w-0` does the same job horizontally.
          */}
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
            {active ? (
              <img
                key={active.publicId}
                src={galleryImageUrl(active.imageKey)}
                alt={active.altText}
                className="max-h-full max-w-full object-contain"
              />
            ) : null}

            {activeIndex > 0 ? (
              <button
                type="button"
                onClick={() => onChange(photos[activeIndex - 1].publicId)}
                className="absolute left-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 sm:left-2 sm:size-12"
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-5 sm:size-6" />
              </button>
            ) : null}
            {activeIndex < photos.length - 1 ? (
              <button
                type="button"
                onClick={() => onChange(photos[activeIndex + 1].publicId)}
                className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 sm:right-2 sm:size-12"
                aria-label="Next photo"
              >
                <ChevronRight className="size-5 sm:size-6" />
              </button>
            ) : null}
          </div>

          {/* Caption + metadata strip */}
          {active && (active.caption || active.credit || active.tag) ? (
            <div className="shrink-0 space-y-1 pt-3 text-sm text-white">
              {active.caption ? (
                <p className="font-medium">{active.caption}</p>
              ) : null}
              {active.credit || active.tag ? (
                <p className="text-xs text-white/70">
                  {active.credit ? `Photo by ${active.credit}` : null}
                  {active.credit && active.tag ? " · " : null}
                  {active.tag}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
