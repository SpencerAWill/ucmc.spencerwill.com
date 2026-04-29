import { Image as ImageIcon, Plus, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { Textarea } from "#/components/ui/textarea";
import { useRemoveAboutImage } from "#/features/landing/api/use-remove-about-image";
import { useSetAboutImage } from "#/features/landing/api/use-set-about-image";
import { useUpdateLandingSetting } from "#/features/landing/api/use-update-setting";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import { noPasswordManagerProps } from "#/features/landing/lib/no-password-manager";
import { useImageCrop } from "#/features/landing/lib/use-image-crop";
import {
  LANDING_LIMITS,
  LANDING_SETTING_KEYS,
} from "#/features/landing/server/landing-schemas";

export interface AboutEditorProps {
  paragraphs: string[];
  imageKey: string | null;
  onClose: () => void;
}

export function AboutEditor({
  paragraphs,
  imageKey,
  onClose,
}: AboutEditorProps) {
  const [draft, setDraft] = useState<string[]>(
    paragraphs.length > 0 ? paragraphs : [""],
  );
  const update = useUpdateLandingSetting();
  const setImage = useSetAboutImage();
  const removeImage = useRemoveAboutImage();
  const crop = useImageCrop({
    aspect: 4 / 3,
    outputWidth: 1200,
    outputHeight: 900,
  });

  function setAt(i: number, value: string) {
    setDraft((d) => d.map((p, j) => (j === i ? value : p)));
  }
  function addParagraph() {
    if (draft.length >= LANDING_LIMITS.aboutParagraphCount.max) {
      return;
    }
    setDraft((d) => [...d, ""]);
  }
  function removeAt(i: number) {
    setDraft((d) => (d.length > 1 ? d.filter((_, j) => j !== i) : d));
  }

  async function saveText() {
    const trimmed = draft.map((p) => p.trim()).filter((p) => p.length > 0);
    if (trimmed.length < LANDING_LIMITS.aboutParagraphCount.min) {
      toast.error("Add at least one paragraph.");
      return;
    }
    try {
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.aboutParagraphs,
        value: trimmed,
      });
      toast.success("About copy saved");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t save the about section.",
      );
    }
  }

  async function uploadImage() {
    const dataUrl = await crop.getCroppedDataUrl();
    if (!dataUrl) {
      toast.error("Pick and crop an image first.");
      return;
    }
    try {
      await setImage.mutateAsync({ dataUrl });
      crop.reset();
      toast.success("About image saved");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t upload the image.",
      );
    }
  }

  async function clearImage() {
    if (!window.confirm("Remove the about-section image?")) {
      return;
    }
    try {
      await removeImage.mutateAsync();
      toast.success("About image removed");
    } catch {
      toast.error("Couldn’t remove the image.");
    }
  }

  const busy = update.isPending || setImage.isPending || removeImage.isPending;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Paragraphs</h3>
        {draft.map((p, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`para-${i}`}>Paragraph {i + 1}</Label>
              {draft.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove paragraph ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
            <Textarea
              id={`para-${i}`}
              value={p}
              maxLength={LANDING_LIMITS.aboutParagraph.max}
              onChange={(e) => setAt(i, e.target.value)}
              rows={4}
              {...noPasswordManagerProps}
            />
          </div>
        ))}
        {draft.length < LANDING_LIMITS.aboutParagraphCount.max ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addParagraph}
          >
            <Plus className="mr-1.5 size-4" />
            Add paragraph
          </Button>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={saveText} disabled={busy}>
            {update.isPending ? "Saving…" : "Save copy"}
          </Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Image</h3>
        <p className="text-xs text-muted-foreground">
          Optional. Renders alongside the paragraphs on desktop and stacks above
          on mobile.
        </p>

        {crop.workingUrl ? (
          <div className="space-y-2">
            <ReactCrop {...crop.reactCropProps}>
              <img {...crop.imgProps} />
            </ReactCrop>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={crop.reset}
                disabled={busy}
              >
                <X className="mr-1 size-3.5" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={uploadImage}
                disabled={busy || !crop.hasCompletedCrop}
              >
                {setImage.isPending ? "Uploading…" : "Use image"}
              </Button>
            </div>
          </div>
        ) : imageKey ? (
          <div className="space-y-2">
            <div className="aspect-[4/3] w-64 overflow-hidden rounded-md border">
              <img
                src={landingImageUrlFor(imageKey)}
                alt=""
                className="size-full object-cover"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={crop.openPicker}
                disabled={busy}
              >
                <Upload className="mr-1.5 size-4" />
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearImage}
                disabled={busy}
              >
                <Trash2 className="mr-1.5 size-4" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={crop.openPicker}
            disabled={busy}
          >
            <ImageIcon className="mr-1.5 size-4" />
            Pick an image
          </Button>
        )}
        <input
          ref={crop.fileInputRef}
          id="about-image"
          {...crop.fileInputProps}
        />
      </section>

      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
