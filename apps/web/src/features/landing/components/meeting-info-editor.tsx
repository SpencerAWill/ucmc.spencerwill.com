import { Image as ImageIcon, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { useRemoveMeetingImage } from "#/features/landing/api/use-remove-meeting-image";
import { useSetMeetingImage } from "#/features/landing/api/use-set-meeting-image";
import { useUpdateLandingSetting } from "#/features/landing/api/use-update-setting";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import { noPasswordManagerProps } from "#/features/landing/lib/no-password-manager";
import { useImageCrop } from "#/features/landing/lib/use-image-crop";
import {
  LANDING_LIMITS,
  LANDING_SETTING_KEYS,
} from "#/features/landing/server/landing-schemas";

export interface MeetingInfoEditorProps {
  values: {
    dayTime: string;
    location: string;
    email: string;
    instagramUrl: string;
  };
  imageKey: string | null;
  onClose: () => void;
}

export function MeetingInfoEditor({
  values,
  imageKey,
  onClose,
}: MeetingInfoEditorProps) {
  const [dayTime, setDayTime] = useState(values.dayTime);
  const [location, setLocation] = useState(values.location);
  const [email, setEmail] = useState(values.email);
  const [instagramUrl, setInstagramUrl] = useState(values.instagramUrl);
  const update = useUpdateLandingSetting();
  const setImage = useSetMeetingImage();
  const removeImage = useRemoveMeetingImage();
  // Wider 16:9 crop — typical inputs are buildings or maps where the
  // wide framing reads better than the squarer 4:3 we use for activities.
  const crop = useImageCrop({
    aspect: 16 / 9,
    outputWidth: 1920,
    outputHeight: 1080,
  });

  async function saveText() {
    try {
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.meetingDayTime,
        value: dayTime.trim(),
      });
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.meetingLocation,
        value: location.trim(),
      });
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.meetingEmail,
        value: email.trim(),
      });
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.meetingInstagramUrl,
        value: instagramUrl.trim(),
      });
      toast.success("Meeting info saved");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t save the meeting info.",
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
      toast.success("Meeting image saved");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t upload the image.",
      );
    }
  }

  async function clearImage() {
    if (!window.confirm("Remove the meeting-section image?")) {
      return;
    }
    try {
      await removeImage.mutateAsync();
      toast.success("Meeting image removed");
    } catch {
      toast.error("Couldn’t remove the image.");
    }
  }

  const busy = update.isPending || setImage.isPending || removeImage.isPending;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Details</h3>
        <div className="space-y-1.5">
          <Label htmlFor="meeting-day-time">Meeting day & time</Label>
          <Input
            id="meeting-day-time"
            value={dayTime}
            maxLength={LANDING_LIMITS.meetingField.max}
            onChange={(e) => setDayTime(e.target.value)}
            placeholder="e.g. Wednesdays at 7pm"
            {...noPasswordManagerProps}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="meeting-location">Location</Label>
          <Input
            id="meeting-location"
            value={location}
            maxLength={LANDING_LIMITS.meetingField.max}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Building, room number"
            {...noPasswordManagerProps}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="meeting-email">Contact email</Label>
          <Input
            id="meeting-email"
            type="email"
            value={email}
            maxLength={LANDING_LIMITS.meetingField.max}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ucmc@example.com"
            {...noPasswordManagerProps}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="meeting-instagram">Instagram URL</Label>
          <Input
            id="meeting-instagram"
            type="url"
            value={instagramUrl}
            maxLength={LANDING_LIMITS.meetingField.max}
            onChange={(e) => setInstagramUrl(e.target.value)}
            placeholder="https://instagram.com/..."
            {...noPasswordManagerProps}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to hide the Instagram link.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={saveText} disabled={busy}>
            {update.isPending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Background image</h3>
        <p className="text-xs text-muted-foreground">
          Optional. Could be a photo of the building you meet in or a map of
          campus. Renders behind the info card on desktop and stacks above on
          mobile.
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
            <div className="aspect-video w-full max-w-md overflow-hidden rounded-md border">
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
          id="meeting-image"
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
