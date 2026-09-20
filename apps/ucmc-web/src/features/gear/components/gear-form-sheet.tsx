import { useQuery } from "@tanstack/react-query";
import {
  ACQUISITION_KIND_LABEL,
  CONDITION_LABEL,
} from "#/features/gear/lib/labels";
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
  gearModelsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { useCreateGear } from "#/features/gear/api/use-create-gear";
import { useEditGear } from "#/features/gear/api/use-edit-gear";
import {
  GearAttributeFields,
  attributeFormValuesFrom,
  attributeInputsFrom,
} from "#/features/gear/components/gear-attribute-fields";
import type { AttributeFormValues } from "#/features/gear/components/gear-attribute-fields";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import { toDateInputValue } from "#/lib/date-format";
import {
  GEAR_ACQUISITION_KIND_VALUES,
  GEAR_CONDITION_VALUES,
} from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearAcquisitionKind,
  GearDetail,
  GearSummary,
} from "#/features/gear/server/gear-fns";
import { useCreateGearModel } from "#/features/gear/api/use-create-gear-model";

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

// Sentinel value for "no grade" — `<Select>` can't accept an empty
// string as an item value, so we round-trip through a literal that
// won't collide with any real enum member.
const ACQUISITION_KIND_NONE = "__none__";

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
  // Attribute answers ride on GearDetail too, and the same rule applies
  // for the same reason: a form that never received them must not offer
  // to overwrite them. Sending `attributes: []` from the list would be
  // read as "every answer cleared", which `resolveAttributeWrites` turns
  // into "<label> is required" the moment the type has a required
  // item-level definition — the officer simply can't save from there.
  const showAttributes = !isEdit || hasDetailFields;
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
    isEdit && intent.gear.acquiredAt
      ? toDateInputValue(intent.gear.acquiredAt)
      : "",
  );
  const [costDollars, setCostDollars] = useState<string>(
    isEdit && intent.gear.acquisitionCostCents !== null
      ? (intent.gear.acquisitionCostCents / 100).toFixed(2)
      : "",
  );
  const [manufacturedAt, setManufacturedAt] = useState<string>(
    isEdit && intent.gear.manufacturedAt !== null
      ? toDateInputValue(intent.gear.manufacturedAt)
      : "",
  );
  const [modelPublicId, setModelPublicId] = useState<string>(
    isEdit ? intent.gear.model.publicId : "",
  );
  // The type select scopes the model list and drives the code
  // suggestion; the model is what the item actually references.
  const { data: models } = useQuery(
    gearModelsQueryOptions(typePublicId || null),
  );
  // Inline creation, because an officer adding the club's first pair of
  // draws shouldn't have to leave the sheet to define the product first.
  // Editing a model's MSRP and service life is a separate surface.
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [newModelManufacturer, setNewModelManufacturer] = useState("");
  const createModel = useCreateGearModel();

  const handleCreateModel = () => {
    if (!typePublicId || newModelName.trim().length === 0) return;
    createModel.mutate(
      {
        typePublicId,
        name: newModelName.trim(),
        manufacturer:
          newModelManufacturer.trim().length === 0
            ? null
            : newModelManufacturer.trim(),
        tracking: "coded",
        description: null,
        msrpCents: null,
        serviceLifeYears: null,
        inspectionIntervalDays: null,
        productUrl: null,
        attributes: attributeInputsFrom(newModelAttributes),
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setModelPublicId(result.publicId);
            setNewModelOpen(false);
            setNewModelName("");
            setNewModelManufacturer("");
            setNewModelAttributes({});
          } else {
            setError(
              result.reason === "invalid_attribute"
                ? result.message
                : result.reason === "name_in_use"
                  ? "A model with that name already exists for this type."
                  : "Pick a type first.",
            );
          }
        },
        onError: () => setError("Couldn't create the model."),
      },
    );
  };
  const [serialNumber, setSerialNumber] = useState<string>(
    isEdit && "serialNumber" in intent.gear
      ? (intent.gear.serialNumber ?? "")
      : "",
  );
  const [acquisitionKind, setAcquisitionKind] = useState<
    GearAcquisitionKind | typeof ACQUISITION_KIND_NONE
  >(
    isEdit && intent.gear.acquisitionKind !== null
      ? intent.gear.acquisitionKind
      : ACQUISITION_KIND_NONE,
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
  // Seeded from whatever the detail payload carried; the model-level
  // answers riding along in that same list are filtered out by the
  // fields block, which only knows about item-level definitions.
  const [attributeValues, setAttributeValues] = useState<AttributeFormValues>(
    isEdit && "attributes" in intent.gear
      ? attributeFormValuesFrom(
          intent.gear.attributes,
          new Set(intent.gear.attributes.map((a) => a.defPublicId)),
        )
      : {},
  );
  // Model-level answers, collected only while creating a model inline.
  const [newModelAttributes, setNewModelAttributes] =
    useState<AttributeFormValues>({});
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
    if (!modelPublicId) {
      setError("Pick a model first.");
      return;
    }
    // No longer required: the model supplies the product name, so this
    // field is now only for per-unit distinguishing marks.
    const trimmedDescription = description.trim();
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
    const manufacturedAtMs =
      manufacturedAt.trim().length === 0
        ? null
        : Date.parse(`${manufacturedAt}T00:00:00Z`);
    if (manufacturedAtMs !== null && Number.isNaN(manufacturedAtMs)) {
      setError("Date of manufacture isn't a valid date.");
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
      modelPublicId,
      code: code.trim().length === 0 ? null : code.trim(),
      description: trimmedDescription.length === 0 ? null : trimmedDescription,
      acquiredAt: acquiredAtMs,
      manufacturedAt: manufacturedAtMs,
      acquisitionCostCents: cents,
      acquisitionKind:
        acquisitionKind === ACQUISITION_KIND_NONE ? null : acquisitionKind,
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
      if (showAttributes) {
        editPayload.attributes = attributeInputsFrom(attributeValues);
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
            setError(
              result.reason === "invalid_attribute"
                ? result.message
                : `Code "${result.code}" is already in use.`,
            );
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
        attributes: attributeInputsFrom(attributeValues),
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(
              result.code ? `Added ${result.code}` : "Gear added (no code yet)",
            );
            onClose();
          } else {
            setError(
              result.reason === "invalid_attribute"
                ? result.message
                : `Code "${result.code}" is already in use.`,
            );
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
          <Label htmlFor="gear-model">Model</Label>
          <Select
            value={modelPublicId}
            onValueChange={setModelPublicId}
            disabled={!typePublicId}
          >
            <SelectTrigger id="gear-model" className="w-full">
              <SelectValue
                placeholder={
                  typePublicId ? "Select a model…" : "Pick a type first"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(models ?? []).map((m) => (
                <SelectItem key={m.publicId} value={m.publicId}>
                  {m.manufacturer ? `${m.manufacturer} ` : ""}
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {newModelOpen ? (
            <div className="space-y-2 rounded-md border p-3">
              {/* Manufacturer first, matching the models dialog and the
               * way every list renders the pair: "Petzl Corax". */}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label="New model manufacturer"
                  value={newModelManufacturer}
                  onChange={(e) => setNewModelManufacturer(e.target.value)}
                  placeholder="Petzl"
                  maxLength={100}
                />
                <Input
                  aria-label="New model name"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="Corax"
                  maxLength={200}
                />
              </div>
              {/* Model-level attributes belong to the product, so they
               * are answered while the product is being defined — not
               * later, per item, forty times over. */}
              <GearAttributeFields
                typePublicId={typePublicId || null}
                level="model"
                values={newModelAttributes}
                onChange={setNewModelAttributes}
                idPrefix="new-model"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateModel}
                  disabled={
                    newModelName.trim().length === 0 || createModel.isPending
                  }
                >
                  Create model
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setNewModelOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={!typePublicId}
              onClick={() => setNewModelOpen(true)}
            >
              New model…
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            The product this unit is. Manufacturer, MSRP and service life live
            on the model, so they're set once for the whole fleet.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gear-description">Distinguishing marks</Label>
          <Input
            id="gear-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Blue tape on the spine"
            maxLength={500}
          />
          {/* Not required, matching the schema: the model supplies the
              name, so most pieces have nothing to say here. It was
              marked required with "Black Diamond Momentum, size M" for a
              placeholder, which made every officer re-type the product
              and the size — the two things the model layer and the
              attributes exist to stop duplicating. */}
          <p className="text-xs text-muted-foreground">
            Optional. What tells this unit apart from the others like it — the
            card falls back to the model's name.
          </p>
        </div>

        {/* Thumbnail picker, below the identity fields rather than
         * above them. It used to open the form, so the first thing an
         * officer met was an optional photo — and per-unit photos are
         * the less useful kind now that the product shot lives on the
         * model and every unit falls back to it. Type, code and model
         * are what the form is for.
         *
         * The clickable preview IS the upload affordance — empty state
         * shows an "Add" hint, populated state shows the image and
         * clicking it re-opens the file picker (replace). Remove is a
         * separate text button only when there's something to
         * remove. */}
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
        <div
          className={
            showSerialNumber ? "grid grid-cols-2 gap-3" : "space-y-1.5"
          }
        >
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
            <Label htmlFor="gear-manufactured">Date of manufacture</Label>
            <Input
              id="gear-manufactured"
              type="date"
              value={manufacturedAt}
              onChange={(e) => setManufacturedAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Off the tag. Service life runs from here, not from when we bought
              it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gear-acquisition-kind">Acquisition</Label>
            <Select
              value={acquisitionKind}
              onValueChange={(v) =>
                setAcquisitionKind(
                  v as GearAcquisitionKind | typeof ACQUISITION_KIND_NONE,
                )
              }
            >
              <SelectTrigger id="gear-acquisition-kind" className="w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ACQUISITION_KIND_NONE}>
                  <span className="text-muted-foreground">Unknown</span>
                </SelectItem>
                {GEAR_ACQUISITION_KIND_VALUES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {ACQUISITION_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Tells a zero cost apart from a missing receipt.
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
        {/* Item-level attributes — the ones that vary unit to unit.
         * Renders nothing when the type has no definitions attached, so
         * a club that never defines any sees the form it had before,
         * and nothing when the caller handed us a summary: controls
         * seeded blank from answers we never received would invite the
         * officer to overwrite them with nothing. */}
        {showAttributes ? (
          <GearAttributeFields
            typePublicId={typePublicId || null}
            level="item"
            values={attributeValues}
            onChange={setAttributeValues}
            idPrefix="gear"
          />
        ) : null}
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
