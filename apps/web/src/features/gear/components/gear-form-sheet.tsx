import { useQuery } from "@tanstack/react-query";
import imageCompression from "browser-image-compression";
import { ImagePlus, Trash2 } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import {
  gearSuggestedCodeQueryOptions,
  gearTagsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { useCreateGear } from "#/features/gear/api/use-create-gear";
import { useEditGear } from "#/features/gear/api/use-edit-gear";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import {
  GEAR_CONDITION_GRADE_VALUES,
  GEAR_CONDITION_VALUES,
} from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearConditionGrade,
  GearDetail,
  GearSummary,
} from "#/features/gear/server/gear-fns";

// Lazy-load the TipTap editor the same way `field.MarkdownField` does
// — keeps the ~265 KB-gz editor bundle off any route that doesn't
// actually mount the gear form sheet.
const MarkdownEditorLazy = lazy(() =>
  import("#/components/editor/markdown-editor").then((m) => ({
    default: m.MarkdownEditor,
  })),
);

function MarkdownEditorFallback({ rows }: { rows: number }) {
  return (
    <div
      aria-hidden
      className="w-full animate-pulse rounded-md border bg-muted/30"
      style={{ minHeight: `${rows * 1.5 + 3}rem` }}
    />
  );
}

const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

const CONDITION_GRADE_LABEL: Record<GearConditionGrade, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
};

// Sentinel value for "no grade" — `<Select>` can't accept an empty
// string as an item value, so we round-trip through a literal that
// won't collide with any real enum member.
const CONDITION_GRADE_NONE = "__none__";

export type GearFormMode =
  | { mode: "create" }
  | { mode: "edit"; gear: GearSummary | GearDetail };

export function GearFormSheet({
  open,
  onOpenChange,
  intent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: GearFormMode;
}) {
  const isEdit = intent.mode === "edit";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit gear" : "Add gear"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update fields, change the code, retag, or change condition."
              : "Add a single piece of gear. Use the bulk import sheet for many at once."}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <GearForm intent={intent} onClose={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function GearForm({
  intent,
  onClose,
}: {
  intent: GearFormMode;
  onClose: () => void;
}) {
  const isEdit = intent.mode === "edit";
  // True only when the caller handed us a GearDetail (the gear detail
  // page does; the list page passes a GearSummary, which omits
  // `serialNumber`). Drives whether to render the serial input — if we
  // never received the real value we shouldn't offer to overwrite it.
  const hasDetailFields = isEdit && "serialNumber" in intent.gear;
  const showSerialNumber = !isEdit || hasDetailFields;
  const { data: types } = useQuery(gearTypesQueryOptions());
  const { data: tags } = useQuery(gearTagsQueryOptions());
  const createMutation = useCreateGear();
  const editMutation = useEditGear();

  const [typePublicId, setTypePublicId] = useState<string>(
    isEdit ? intent.gear.type.publicId : "",
  );
  const [code, setCode] = useState<string>(
    isEdit ? (intent.gear.code ?? "") : "",
  );
  const [description, setDescription] = useState<string>(
    isEdit ? intent.gear.description : "",
  );
  const [acquiredAtIso, setAcquiredAtIso] = useState<string>(
    isEdit && intent.gear.acquiredAt ? toIsoDate(intent.gear.acquiredAt) : "",
  );
  const [costDollars, setCostDollars] = useState<string>(
    isEdit && intent.gear.acquisitionCostCents !== null
      ? (intent.gear.acquisitionCostCents / 100).toFixed(2)
      : "",
  );
  const [msrpDollars, setMsrpDollars] = useState<string>(
    isEdit && intent.gear.msrpCents !== null
      ? (intent.gear.msrpCents / 100).toFixed(2)
      : "",
  );
  const [manufacturer, setManufacturer] = useState<string>(
    isEdit ? (intent.gear.manufacturer ?? "") : "",
  );
  const [serialNumber, setSerialNumber] = useState<string>(
    isEdit && "serialNumber" in intent.gear
      ? (intent.gear.serialNumber ?? "")
      : "",
  );
  const [conditionGrade, setConditionGrade] = useState<
    GearConditionGrade | typeof CONDITION_GRADE_NONE
  >(
    isEdit && intent.gear.conditionGrade !== null
      ? intent.gear.conditionGrade
      : CONDITION_GRADE_NONE,
  );
  const [notes, setNotes] = useState<string>(
    isEdit && "notesMarkdown" in intent.gear
      ? (intent.gear.notesMarkdown ?? "")
      : "",
  );
  const [condition, setCondition] = useState<GearCondition>(
    isEdit ? intent.gear.condition : "serviceable",
  );
  const [tagPublicIds, setTagPublicIds] = useState<string[]>(
    isEdit ? intent.gear.tags.map((t) => t.publicId) : [],
  );
  // Thumbnail state is a tri-state at the form layer:
  //   - newDataUrl !== null → user picked a new image; send it
  //   - cleared === true    → user removed an existing thumbnail; send null
  //   - both false/null     → no thumbnail change; send undefined on edit,
  //                            or null on create (no thumbnail to start)
  const existingThumbnailKey = isEdit ? intent.gear.thumbnailKey : null;
  const [newThumbnailDataUrl, setNewThumbnailDataUrl] = useState<string | null>(
    null,
  );
  const [thumbnailCleared, setThumbnailCleared] = useState(false);
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggested = useQuery(
    gearSuggestedCodeQueryOptions(typePublicId || null),
  );

  // Auto-fill the code when type changes (create only, only if code is empty).
  const suggestion = suggested.data?.suggestion;
  useEffect(() => {
    if (isEdit) return;
    if (!suggestion) return;
    if (code.trim().length > 0) return;
    setCode(suggestion);
  }, [isEdit, suggestion, typePublicId, code]);

  const submitting = createMutation.isPending || editMutation.isPending;

  async function onThumbnailPicked(file: File) {
    setThumbnailBusy(true);
    try {
      // Compress to ~600px max and re-encode as JPEG so the server-side
      // size cap (400 KB) is comfortably met for nearly any input.
      const normalized = await imageCompression(file, {
        maxWidthOrHeight: 600,
        useWebWorker: true,
        fileType: "image/jpeg",
        initialQuality: 0.82,
      });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(normalized);
      });
      setNewThumbnailDataUrl(dataUrl);
      setThumbnailCleared(false);
    } catch {
      toast.error("Couldn't read that image. Try another file.");
    } finally {
      setThumbnailBusy(false);
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = "";
      }
    }
  }

  function removeThumbnail() {
    setNewThumbnailDataUrl(null);
    setThumbnailCleared(true);
  }

  // Preview source picks the newest pick, else the existing key (if not
  // cleared), else nothing.
  const thumbnailPreviewSrc =
    newThumbnailDataUrl ??
    (!thumbnailCleared && existingThumbnailKey
      ? gearThumbnailUrlFor(existingThumbnailKey)
      : null);

  const handleSubmit = () => {
    setError(null);
    if (!typePublicId) {
      setError("Pick a type first.");
      return;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription.length === 0) {
      setError("Description is required.");
      return;
    }
    const acquiredAtMs =
      acquiredAtIso.length > 0
        ? Date.parse(`${acquiredAtIso}T00:00:00Z`)
        : null;
    if (acquiredAtMs !== null && Number.isNaN(acquiredAtMs)) {
      setError("Acquired date is not a valid date.");
      return;
    }
    const cents =
      costDollars.trim().length > 0
        ? Math.round(Number(costDollars) * 100)
        : null;
    if (cents !== null && (!Number.isFinite(cents) || cents < 0)) {
      setError("Cost must be a non-negative number.");
      return;
    }
    const msrp =
      msrpDollars.trim().length > 0
        ? Math.round(Number(msrpDollars) * 100)
        : null;
    if (msrp !== null && (!Number.isFinite(msrp) || msrp < 0)) {
      setError("MSRP must be a non-negative number.");
      return;
    }
    const trimmedSerial =
      serialNumber.trim().length === 0 ? null : serialNumber;
    // `serialNumber` lives only on GearDetail. When the sheet is
    // opened from the gear list (which passes a GearSummary), the
    // form falls back to empty, and naively including it in the edit
    // payload would clobber the stored value — `editGearAction`
    // treats any present-but-different field as an intentional
    // change. Only send it on edit when the caller gave us a
    // detail-shaped source so it round-trips safely.
    const basePayload = {
      typePublicId,
      code: code.trim().length === 0 ? null : code.trim(),
      description: trimmedDescription,
      acquiredAt: acquiredAtMs,
      acquisitionCostCents: cents,
      msrpCents: msrp,
      manufacturer: manufacturer.trim().length === 0 ? null : manufacturer,
      conditionGrade:
        conditionGrade === CONDITION_GRADE_NONE ? null : conditionGrade,
      notesMarkdown: notes.trim().length === 0 ? null : notes,
      condition,
      tagPublicIds,
    };

    if (isEdit) {
      // Three-way thumbnail handling:
      //   - new image picked → send the new data URL
      //   - explicitly cleared → send null (server deletes the R2 object)
      //   - neither → omit so the existing key stays untouched
      const editPayload: Parameters<typeof editMutation.mutate>[0] = {
        publicId: intent.gear.publicId,
        ...basePayload,
      };
      if (hasDetailFields) {
        editPayload.serialNumber = trimmedSerial;
      }
      if (newThumbnailDataUrl !== null) {
        editPayload.thumbnailDataUrl = newThumbnailDataUrl;
      } else if (thumbnailCleared) {
        editPayload.thumbnailDataUrl = null;
      }
      editMutation.mutate(editPayload, {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success("Gear updated");
            onClose();
          } else {
            setError(`Code "${result.code}" is already in use.`);
          }
        },
        onError: () => setError("Couldn't save changes."),
      });
      return;
    }
    createMutation.mutate(
      {
        ...basePayload,
        serialNumber: trimmedSerial,
        thumbnailDataUrl: newThumbnailDataUrl,
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(
              result.code ? `Added ${result.code}` : "Gear added (no code yet)",
            );
            onClose();
          } else {
            setError(`Code "${result.code}" is already in use.`);
          }
        },
        onError: () => setError("Couldn't add gear."),
      },
    );
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <fieldset
        disabled={submitting}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-0 px-4 pb-4"
      >
        {/* Thumbnail picker. The clickable preview IS the upload
         * affordance — empty state shows an "Add" hint, populated state
         * shows the image and clicking it re-opens the file picker
         * (replace). Remove is a separate text button only when there's
         * something to remove. */}
        <div className="space-y-1.5">
          <Label>Thumbnail</Label>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => thumbnailInputRef.current?.click()}
              className="relative size-24 shrink-0 overflow-hidden rounded-md border bg-muted transition-colors hover:border-foreground/40 disabled:opacity-50"
              disabled={thumbnailBusy || submitting}
              aria-label={
                thumbnailPreviewSrc ? "Replace thumbnail" : "Add thumbnail"
              }
            >
              {thumbnailPreviewSrc ? (
                <img
                  src={thumbnailPreviewSrc}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                  <ImagePlus className="size-5" />
                  <span className="text-xs">Add</span>
                </div>
              )}
            </button>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {thumbnailPreviewSrc
                  ? "Click the preview to replace."
                  : "Click the box to upload. Square works best; auto-compressed to ~600px JPEG."}
              </p>
              {thumbnailPreviewSrc ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={removeThumbnail}
                  disabled={thumbnailBusy || submitting}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              ) : null}
            </div>
            <input
              ref={thumbnailInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onThumbnailPicked(file);
              }}
            />
          </div>
        </div>

        {/* Type and Code sit on one row — type drives the suggested
         * code prefix, so visually pairing them makes the cause-effect
         * obvious. Stack on the narrowest viewports so the type-select
         * trigger doesn't get squished. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_minmax(8rem,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="gear-type">Type</Label>
            <Select value={typePublicId} onValueChange={setTypePublicId}>
              <SelectTrigger id="gear-type" className="w-full">
                <SelectValue placeholder="Select a type…" />
              </SelectTrigger>
              <SelectContent>
                {(types ?? []).map((t) => (
                  <SelectItem key={t.publicId} value={t.publicId}>
                    {t.name}
                    {t.prefix ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {t.prefix}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gear-code">Code</Label>
            <Input
              id="gear-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={suggested.data?.suggestion || "CH4"}
              maxLength={64}
            />
            <p className="text-xs text-muted-foreground">
              Laminated tag. Blank for unlabeled.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gear-description">
            Description / model
            <span className="text-destructive" aria-hidden>
              {" *"}
            </span>
          </Label>
          <Input
            id="gear-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Black Diamond Momentum, size M"
            maxLength={500}
            required
            aria-required
          />
          <p className="text-xs text-muted-foreground">
            Primary heading on the gear card.
          </p>
        </div>
        <div
          className={
            showSerialNumber ? "grid grid-cols-2 gap-3" : "space-y-1.5"
          }
        >
          <div className="space-y-1.5">
            <Label htmlFor="gear-manufacturer">Manufacturer</Label>
            <Input
              id="gear-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="Petzl"
              maxLength={100}
            />
          </div>
          {showSerialNumber ? (
            <div className="space-y-1.5">
              <Label htmlFor="gear-serial">Serial number</Label>
              <Input
                id="gear-serial"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="ABC-12345"
                maxLength={100}
              />
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="gear-acquired">Acquired</Label>
            <Input
              id="gear-acquired"
              type="date"
              value={acquiredAtIso}
              onChange={(e) => setAcquiredAtIso(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gear-cost">Cost (USD)</Label>
            <Input
              id="gear-cost"
              type="number"
              step="0.01"
              min="0"
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="60.00"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="gear-msrp">MSRP (USD)</Label>
            <Input
              id="gear-msrp"
              type="number"
              step="0.01"
              min="0"
              value={msrpDollars}
              onChange={(e) => setMsrpDollars(e.target.value)}
              placeholder="84.95"
            />
            <p className="text-xs text-muted-foreground">
              Manufacturer's listed price — used for replacement-value
              reporting.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gear-condition-grade">Condition grade</Label>
            <Select
              value={conditionGrade}
              onValueChange={(v) =>
                setConditionGrade(
                  v as GearConditionGrade | typeof CONDITION_GRADE_NONE,
                )
              }
            >
              <SelectTrigger id="gear-condition-grade" className="w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CONDITION_GRADE_NONE}>
                  <span className="text-muted-foreground">No grade</span>
                </SelectItem>
                {GEAR_CONDITION_GRADE_VALUES.map((g) => (
                  <SelectItem key={g} value={g}>
                    {CONDITION_GRADE_LABEL[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Subjective wear level — independent of repair status.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gear-condition">Condition</Label>
          <Select
            value={condition}
            onValueChange={(v) => setCondition(v as GearCondition)}
          >
            <SelectTrigger id="gear-condition" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GEAR_CONDITION_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Tags</Label>
          <GearTagMultiselect
            allTags={tags ?? []}
            selectedPublicIds={tagPublicIds}
            onChange={setTagPublicIds}
            canCreate
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gear-notes" id="gear-notes-label">
            Notes
          </Label>
          {/* MarkdownEditor renders a contenteditable, so the label
           * association is via aria-labelledby rather than htmlFor. */}
          <Suspense fallback={<MarkdownEditorFallback rows={4} />}>
            <MarkdownEditorLazy
              value={notes}
              onChange={setNotes}
              placeholder="Free-form notes — visible to anyone with gear:read. Markdown supported."
              rows={4}
              maxLength={10_000}
              ariaLabelledBy="gear-notes-label"
            />
          </Suspense>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <SheetFooter>
        <Button type="submit" disabled={submitting}>
          {isEdit ? "Save changes" : "Add gear"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function toIsoDate(d: Date): string {
  // Format as YYYY-MM-DD in UTC — the same shape the `<input type="date">`
  // returns.
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}
