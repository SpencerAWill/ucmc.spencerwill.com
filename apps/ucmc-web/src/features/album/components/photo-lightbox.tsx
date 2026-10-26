import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Maximize2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { albumFullUrl, albumImageUrl } from "#/features/album/lib/image-url";
import type { AlbumPhotoSummary } from "#/features/album/server/album-fns";
import { useAuth } from "#/features/auth/api/use-auth";
import { cn } from "#/lib/utils";

/**
 * Click-to-zoom modal for the Album grid. Built directly on
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
 * Members who hold `public_album:view_original` also get "Show
 * original" and "Download" for photos that have a full-size copy. The
 * gate is `hasPermission` (never the payload alone) so role emulation
 * hides the controls.
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
  photos: AlbumPhotoSummary[];
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

  const { hasPermission } = useAuth();
  // Keyed by photo, so moving to another photo falls back to the crop
  // without an effect. `loaded` flips when the preload finishes.
  const [original, setOriginal] = useState<{
    publicId: string;
    loaded: boolean;
  } | null>(null);
  // Reset when the active photo changes (including close, where it goes
  // null), so returning to a photo never finds the toggle still on.
  const [prevActiveId, setPrevActiveId] = useState(activePublicId);
  if (prevActiveId !== activePublicId) {
    setPrevActiveId(activePublicId);
    setOriginal(null);
  }
  const fullHash = active?.fullHash ?? null;
  const canViewOriginal =
    hasPermission("public_album:view_original") && fullHash !== null;
  const showOriginal =
    canViewOriginal && original?.publicId === active?.publicId;
  const originalLoaded = showOriginal && original?.loaded === true;

  // Preload while the toggle is on, so the crop stays up until the full
  // image can replace it. A failure (404, or a copy still awaiting
  // self-repair) drops back to the crop with the toggle off and says so
  // in a toast, so the click isn't silently undone. The cleanup
  // detaches the handlers so a late load can't swap in a photo the
  // viewer has already navigated away from.
  const activeId = active?.publicId ?? null;
  const preloading = showOriginal && !originalLoaded;
  useEffect(() => {
    if (!preloading || activeId === null) {
      return;
    }
    const img = new Image();
    img.onload = () => setOriginal({ publicId: activeId, loaded: true });
    img.onerror = () => {
      setOriginal(null);
      toast.error("Couldn't load the full-size photo.");
    };
    img.src = albumFullUrl(activeId, fullHash);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [preloading, activeId, fullHash]);

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
            {active?.caption ?? active?.altText ?? "Album photo"}
          </DialogPrimitive.Title>

          {/* Top bar: counter + close */}
          <div className="flex shrink-0 items-center justify-between gap-4 pb-3 text-sm text-white">
            <span>
              {activeIndex + 1} / {photos.length}
            </span>
            <div className="flex items-center gap-1">
              {active && canViewOriginal ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    // The label stays put and `aria-pressed` carries the
                    // state; pressed reads as a filled button, as the gear
                    // viewfinder's toggles do.
                    className="text-white hover:bg-white/10 hover:text-white aria-pressed:bg-white aria-pressed:text-black aria-pressed:hover:bg-white/90 aria-pressed:hover:text-black"
                    aria-pressed={showOriginal}
                    onClick={() =>
                      setOriginal(
                        showOriginal
                          ? null
                          : { publicId: active.publicId, loaded: false },
                      )
                    }
                  >
                    <Maximize2 className="size-5" />
                    Show original
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/10 hover:text-white"
                  >
                    <a
                      href={albumFullUrl(active.publicId, fullHash, {
                        download: true,
                      })}
                    >
                      <Download className="size-5" />
                      Download
                    </a>
                  </Button>
                </>
              ) : null}
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
          </div>

          {/*
            Image area. `min-h-0` is load-bearing: without it the
            flex item's default `min-height: auto` honors the
            image's intrinsic 1600×1200 and the photo overflows the
            viewport. `min-w-0` does the same job horizontally.
          */}
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
            {active && !originalLoaded ? (
              <img
                key={active.publicId}
                src={albumImageUrl(active.imageKey)}
                alt={active.altText}
                className="max-h-full max-w-full object-contain"
              />
            ) : null}
            {active && originalLoaded ? (
              <img
                key={`${active.publicId}-full`}
                src={albumFullUrl(active.publicId, fullHash)}
                alt={active.altText}
                className="max-h-full max-w-full object-contain"
              />
            ) : null}
            {preloading ? (
              <div
                role="status"
                className="absolute right-2 top-2 rounded-full bg-black/50 p-2 text-white"
              >
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <span className="sr-only">Loading full-size photo</span>
              </div>
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
