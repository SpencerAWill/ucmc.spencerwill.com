import { ImageUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
  useCreateSponsor,
  useUpdateSponsor,
} from "#/features/sponsors/api/use-sponsor-mutations";
import { SponsorLogo } from "#/features/sponsors/components/sponsor-logo";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";
import {
  HTTP_SCHEME,
  SPONSOR_LIMITS,
  SPONSOR_LOGO_MAX_DIMENSION,
} from "#/features/sponsors/server/sponsor-schemas";
import { useImageResize } from "#/hooks/use-image-resize";

export type SponsorFormSeed =
  | { mode: "create" }
  | { mode: "edit"; sponsor: SponsorEntry };

interface FormState {
  name: string;
  websiteUrl: string;
  blurb: string;
  memberPerk: string;
  /** Existing stored logo, or null once the officer clears it. */
  existingLogoKey: string | null;
  existingLogoWidthPx: number | null;
  existingLogoHeightPx: number | null;
}

function seedToForm(seed: SponsorFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      name: seed.sponsor.name,
      websiteUrl: seed.sponsor.websiteUrl ?? "",
      blurb: seed.sponsor.blurb,
      memberPerk: seed.sponsor.memberPerk ?? "",
      existingLogoKey: seed.sponsor.logoKey,
      existingLogoWidthPx: seed.sponsor.logoWidthPx,
      existingLogoHeightPx: seed.sponsor.logoHeightPx,
    };
  }
  return {
    name: "",
    websiteUrl: "",
    blurb: "",
    memberPerk: "",
    existingLogoKey: null,
    existingLogoWidthPx: null,
    existingLogoHeightPx: null,
  };
}

/**
 * Create / edit one sponsor.
 *
 * **`canSeePerks` gates the perk field for a reason that isn't cosmetic.**
 * The read action strips `memberPerk` from the payload for a viewer
 * without `public_sponsors:perks`, so a manager who lacks that grant
 * never receives the stored value — rendering the field would show it
 * blank and then submit that blank over a perk they can't see. When the
 * field is hidden, `memberPerk` is omitted from the update entirely.
 *
 * The logo upload is contain-not-crop (`useImageResize`): a wordmark, a
 * roundel and a stacked mark all keep their own aspect ratio. There is
 * no crop UI because there is nothing to choose — the preview is the
 * result.
 */
export function SponsorFormDialog({
  seed,
  canSeePerks,
  onClose,
}: {
  seed: SponsorFormSeed | null;
  canSeePerks: boolean;
  onClose: () => void;
}) {
  const createMut = useCreateSponsor();
  const updateMut = useUpdateSponsor();
  const [form, setForm] = useState<FormState | null>(null);
  const logoPicker = useImageResize({
    maxDimension: SPONSOR_LOGO_MAX_DIMENSION,
  });
  const { reset: resetPicker } = logoPicker;

  useEffect(() => {
    setForm(seed === null ? null : seedToForm(seed));
    resetPicker();
  }, [seed, resetPicker]);

  const submitting = createMut.isPending || updateMut.isPending;

  /**
   * What to send for `logo`, in the three-state shape the update schema
   * expects: a new upload, `null` to clear, or `undefined` to leave the
   * stored logo alone.
   */
  function logoPayload(original: SponsorEntry | null) {
    if (logoPicker.result) {
      return {
        dataUrl: logoPicker.result.dataUrl,
        widthPx: logoPicker.result.widthPx,
        heightPx: logoPicker.result.heightPx,
      };
    }
    if (original && original.logoKey && form?.existingLogoKey === null) {
      return null;
    }
    return undefined;
  }

  async function submitForm() {
    if (!form || !seed) {
      return;
    }
    const name = form.name.trim();
    const blurb = form.blurb.trim();
    if (name.length === 0 || blurb.length === 0) {
      toast.error("A name and a short description are both required.");
      return;
    }
    const websiteUrl = form.websiteUrl.trim();
    if (websiteUrl.length > 0 && !HTTP_SCHEME.test(websiteUrl)) {
      toast.error("The website must start with http:// or https://.");
      return;
    }
    const perk = form.memberPerk.trim();

    try {
      if (seed.mode === "create") {
        await createMut.mutateAsync({
          name,
          blurb,
          websiteUrl: websiteUrl.length > 0 ? websiteUrl : null,
          memberPerk: canSeePerks && perk.length > 0 ? perk : null,
          logo: logoPicker.result
            ? {
                dataUrl: logoPicker.result.dataUrl,
                widthPx: logoPicker.result.widthPx,
                heightPx: logoPicker.result.heightPx,
              }
            : null,
        });
        toast.success("Sponsor added.");
      } else {
        await updateMut.mutateAsync({
          id: seed.sponsor.id,
          name,
          blurb,
          websiteUrl: websiteUrl.length > 0 ? websiteUrl : null,
          // A manager without the perks grant never received the stored
          // value, so submitting their empty field would wipe it.
          memberPerk: canSeePerks
            ? perk.length > 0
              ? perk
              : null
            : (seed.sponsor.memberPerk ?? null),
          logo: logoPayload(seed.sponsor),
        });
        toast.success("Sponsor updated.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the sponsor.",
      );
    }
  }

  return (
    <Dialog
      open={seed !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {seed?.mode === "edit" ? "Edit sponsor" : "Add sponsor"}
          </DialogTitle>
          <DialogDescription>
            New sponsors land at the end of the list; drag the handle on a row
            to reorder.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="sponsor-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitForm();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="sponsor-name">Name</Label>
              <Input
                id="sponsor-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Roads Rivers and Trails"
                maxLength={SPONSOR_LIMITS.name.max}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sponsor-website">Website</Label>
              <Input
                id="sponsor-website"
                type="url"
                value={form.websiteUrl}
                onChange={(e) =>
                  setForm({ ...form, websiteUrl: e.target.value })
                }
                placeholder="https://example.com"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sponsor-blurb">What they do for the club</Label>
              <Textarea
                id="sponsor-blurb"
                value={form.blurb}
                onChange={(e) => setForm({ ...form, blurb: e.target.value })}
                placeholder="An outfitter in Milford that has outfitted UCMC trips since…"
                rows={3}
                maxLength={SPONSOR_LIMITS.blurb.max}
              />
              <p className="text-xs text-muted-foreground">
                Public — anyone visiting the site reads this.
              </p>
            </div>

            {canSeePerks ? (
              <div className="space-y-1">
                <Label htmlFor="sponsor-perk">Member perk</Label>
                <Textarea
                  id="sponsor-perk"
                  value={form.memberPerk}
                  onChange={(e) =>
                    setForm({ ...form, memberPerk: e.target.value })
                  }
                  placeholder="15% off full-price gear — show your UCMC membership at the register."
                  rows={2}
                  maxLength={SPONSOR_LIMITS.memberPerk.max}
                />
                <p className="text-xs text-muted-foreground">
                  Members only. Signed-out visitors never receive this text.
                  Leave blank if there's no perk.
                </p>
              </div>
            ) : null}

            <LogoField
              form={form}
              setForm={setForm}
              picker={logoPicker}
              disabled={submitting}
            />
          </form>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="sponsor-form"
            disabled={submitting || form === null || logoPicker.isProcessing}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogoField({
  form,
  setForm,
  picker,
  disabled,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  picker: ReturnType<typeof useImageResize>;
  disabled: boolean;
}) {
  const hasNewLogo = picker.result !== null;
  const hasStoredLogo = form.existingLogoKey !== null;

  return (
    <div className="space-y-2">
      <Label htmlFor="sponsor-logo">Logo</Label>
      <div className="flex items-start gap-3">
        {hasNewLogo ? (
          // The freshly-encoded data URL, not the source file: this is
          // exactly the image that will be stored, so what the officer
          // approves is what goes up.
          <div className="flex h-24 w-40 shrink-0 items-center justify-center rounded-md bg-white p-4 ring-1 ring-border/60">
            <img
              src={picker.result?.dataUrl}
              alt=""
              className="max-h-full w-auto max-w-full object-contain"
            />
          </div>
        ) : (
          <SponsorLogo
            name={form.name.trim().length > 0 ? form.name : "No logo"}
            logoKey={form.existingLogoKey}
            widthPx={form.existingLogoWidthPx}
            heightPx={form.existingLogoHeightPx}
            className="w-40 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <input
            id="sponsor-logo"
            ref={picker.fileInputRef}
            {...picker.fileInputProps}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={picker.openPicker}
            disabled={disabled || picker.isProcessing}
          >
            <ImageUp className="size-4" />
            {picker.isProcessing
              ? "Processing…"
              : hasStoredLogo || hasNewLogo
                ? "Replace logo"
                : "Upload logo"}
          </Button>
          {hasNewLogo || hasStoredLogo ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                picker.reset();
                setForm({
                  ...form,
                  existingLogoKey: null,
                  existingLogoWidthPx: null,
                  existingLogoHeightPx: null,
                });
              }}
              disabled={disabled}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            PNG, JPEG or WebP. The mark keeps its own shape — it's scaled to
            fit, never cropped. A transparent PNG stays transparent.
          </p>
          {picker.error ? (
            <p className="text-xs text-destructive">{picker.error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
