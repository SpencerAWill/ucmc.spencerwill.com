/**
 * Combined hero edit dialog body — overlay text (heading + tagline) on
 * top, slide manager below. One affordance, two related concerns.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { Textarea } from "#/components/ui/textarea";
import { useUpdateLandingSetting } from "#/features/landing/api/use-update-setting";
import { HeroSlidesManager } from "#/features/landing/components/hero-slides-manager";
import { noPasswordManagerProps } from "#/features/landing/lib/no-password-manager";
import type { HeroSlideSummary } from "#/features/landing/server/landing-fns";
import {
  LANDING_LIMITS,
  LANDING_SETTING_KEYS,
} from "#/features/landing/server/landing-schemas";

export interface HeroEditorProps {
  heading: string;
  tagline: string;
  slides: HeroSlideSummary[];
  onSaved: () => void;
}

export function HeroEditor({
  heading,
  tagline,
  slides,
  onSaved,
}: HeroEditorProps) {
  const [draftHeading, setDraftHeading] = useState(heading);
  const [draftTagline, setDraftTagline] = useState(tagline);
  const update = useUpdateLandingSetting();

  async function saveText() {
    const h = draftHeading.trim();
    const t = draftTagline.trim();
    if (h.length === 0 || t.length === 0) {
      toast.error("Heading and tagline are required.");
      return;
    }
    try {
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.heroHeading,
        value: h,
      });
      await update.mutateAsync({
        key: LANDING_SETTING_KEYS.heroTagline,
        value: t,
      });
      toast.success("Hero text saved");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t save hero text.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Overlay text</h3>
        <div className="space-y-1.5">
          <Label htmlFor="hero-heading">Heading</Label>
          <Input
            id="hero-heading"
            value={draftHeading}
            maxLength={LANDING_LIMITS.heroHeading.max}
            onChange={(e) => setDraftHeading(e.target.value)}
            {...noPasswordManagerProps}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hero-tagline">Tagline</Label>
          <Textarea
            id="hero-tagline"
            value={draftTagline}
            maxLength={LANDING_LIMITS.heroTagline.max}
            onChange={(e) => setDraftTagline(e.target.value)}
            rows={2}
            {...noPasswordManagerProps}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={saveText}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save text"}
          </Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Slides</h3>
        <HeroSlidesManager slides={slides} />
      </section>

      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onSaved}>
          Done
        </Button>
      </div>
    </div>
  );
}
