/**
 * Image-crop + alt-text editor for a single hero slide. Mirrors avatar-
 * editor's flow but cropped 16:9 since slides are full-bleed.
 */
import { Image as ImageIcon, Upload, X } from "lucide-react";
import { useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useCreateHeroSlide } from "#/features/landing/api/use-create-hero-slide";
import { useUpdateHeroSlide } from "#/features/landing/api/use-update-hero-slide";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import { noPasswordManagerProps } from "#/features/landing/lib/no-password-manager";
import { useImageCrop } from "#/features/landing/lib/use-image-crop";
import type { HeroSlideSummary } from "#/features/landing/server/landing-fns";
import { LANDING_LIMITS } from "#/features/landing/server/landing-schemas";

export interface HeroSlideEditorProps {
  /** Pass an existing slide to enter edit-mode; omit to create. */
  slide?: HeroSlideSummary;
  onSaved: () => void;
  onCancel: () => void;
}

export function HeroSlideEditor({
  slide,
  onSaved,
  onCancel,
}: HeroSlideEditorProps) {
  const isEdit = Boolean(slide);
  const crop = useImageCrop({
    aspect: 16 / 9,
    outputWidth: 1920,
    outputHeight: 1080,
  });
  const [alt, setAlt] = useState(slide?.alt ?? "");
  const [busy, setBusy] = useState(false);

  const createMutation = useCreateHeroSlide();
  const updateMutation = useUpdateHeroSlide();

  async function submit() {
    const trimmedAlt = alt.trim();
    if (
      trimmedAlt.length < LANDING_LIMITS.heroSlideAlt.min ||
      trimmedAlt.length > LANDING_LIMITS.heroSlideAlt.max
    ) {
      toast.error("Alt text is required.");
      return;
    }

    setBusy(true);
    try {
      const dataUrl = (await crop.getCroppedDataUrl()) ?? undefined;
      if (!isEdit && !dataUrl) {
        toast.error("Pick an image to upload.");
        setBusy(false);
        return;
      }

      if (isEdit && slide) {
        await updateMutation.mutateAsync({
          id: slide.id,
          alt: trimmedAlt,
          dataUrl,
        });
        toast.success("Slide updated");
      } else {
        await createMutation.mutateAsync({
          alt: trimmedAlt,
          dataUrl: dataUrl as string,
        });
        toast.success("Slide added");
      }
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t save the slide.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="slide-image">Image</Label>
        {crop.workingUrl ? (
          <div className="space-y-2">
            <ReactCrop {...crop.reactCropProps}>
              <img {...crop.imgProps} />
            </ReactCrop>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={crop.reset}
            >
              <X className="mr-1 size-3.5" />
              Choose a different image
            </Button>
          </div>
        ) : isEdit && slide ? (
          <div className="space-y-2">
            <div className="aspect-[16/9] overflow-hidden rounded-md border">
              <img
                src={landingImageUrlFor(slide.imageKey)}
                alt={slide.alt}
                className="size-full object-cover"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={crop.openPicker}
              disabled={busy}
            >
              <Upload className="mr-1.5 size-4" />
              Replace image
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={crop.openPicker}
            disabled={busy}
          >
            <ImageIcon className="mr-1.5 size-4" />
            Pick an image
          </Button>
        )}
        <input
          ref={crop.fileInputRef}
          id="slide-image"
          {...crop.fileInputProps}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slide-alt">Alt text</Label>
        <Textarea
          id="slide-alt"
          value={alt}
          maxLength={LANDING_LIMITS.heroSlideAlt.max}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Describe the photo for screen readers"
          rows={2}
          className="resize-none"
          {...noPasswordManagerProps}
        />
        <p className="text-xs text-muted-foreground">
          Required. Used by screen readers and shown if the image fails to load.
        </p>
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
          {busy ? "Saving…" : isEdit ? "Save changes" : "Add slide"}
        </Button>
      </div>
    </div>
  );
}
