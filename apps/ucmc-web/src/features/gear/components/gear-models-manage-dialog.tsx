/**
 * Officer-facing model manager — the product layer's own surface.
 *
 * Until now a model could only be created inline from the add-gear
 * sheet, with a name and a manufacturer; MSRP, service life, inspection
 * cadence and the model-level attributes had no editor at all. Those
 * are the fields the model layer was introduced for, so leaving them
 * unwritable made the layer decorative.
 *
 * Lists every model by default, with the type select as a filter. It
 * used to hold the list back until a type was picked, which opened the
 * officer surface for the model layer on an empty select and nothing
 * else — and gave no way to find a model whose type you had forgotten.
 * Creating still wants a type, because a model hangs off one.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  Edit,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Item, ItemActions, ItemContent } from "#/components/ui/item";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import {
  gearModelInspectionsQueryOptions,
  gearModelsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { useCreateGearModel } from "#/features/gear/api/use-create-gear-model";
import { useDeleteGearModel } from "#/features/gear/api/use-delete-gear-model";
import { useSetGearModelStock } from "#/features/gear/api/use-set-gear-model-stock";
import { useUpdateGearModel } from "#/features/gear/api/use-update-gear-model";
import { GearInspectionFormDialog } from "#/features/gear/components/gear-inspection-form-dialog";
import { GearInspectionList } from "#/features/gear/components/gear-inspection-list";
import {
  GearAttributeFields,
  attributeFormValuesFrom,
  attributeInputsFrom,
} from "#/features/gear/components/gear-attribute-fields";
import type { AttributeFormValues } from "#/features/gear/components/gear-attribute-fields";
import { CONDITION_LABEL, TRACKING_LABEL } from "#/features/gear/lib/labels";
import {
  GEAR_CONDITION_VALUES,
  GEAR_TRACKING_VALUES,
} from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearModelSummaryDto,
  GearTracking,
} from "#/features/gear/server/gear-fns";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; model: GearModelSummaryDto }
  | { kind: "stock"; model: GearModelSummaryDto }
  | { kind: "inspections"; model: GearModelSummaryDto };

export function GearModelsManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [typePublicId, setTypePublicId] = useState<string>("");
  const [pendingDelete, setPendingDelete] =
    useState<GearModelSummaryDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data: types } = useQuery(gearTypesQueryOptions());
  // Always enabled, unscoped by default. The dialog used to hold the
  // query back until a type was picked, so the officer surface for the
  // layer this whole rework introduced opened on a lone empty select
  // with no list, no count and no way in — and no way at all to find a
  // model whose type you couldn't remember.
  const { data: models, isLoading } = useQuery(
    gearModelsQueryOptions(typePublicId || null),
  );
  const deleteMutation = useDeleteGearModel();

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteMutation.mutate(
      { publicId: target.publicId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Deleted ${target.name}`);
            setPendingDelete(null);
            setDeleteError(null);
            return;
          }
          setDeleteError(
            result.reason === "has_items"
              ? `${target.name} still has gear under it. Move or retire those pieces first.`
              : "That model no longer exists.",
          );
        },
        onError: () => setDeleteError("Couldn't delete the model."),
      },
    );
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode({ kind: "list" });
      setPendingDelete(null);
      setDeleteError(null);
    }
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mode.kind !== "list" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setMode({ kind: "list" })}
                  aria-label="Back to models"
                >
                  <ArrowLeft className="size-4" />
                </Button>
              ) : null}
              {mode.kind === "list"
                ? "Gear models"
                : mode.kind === "create"
                  ? "New model"
                  : mode.kind === "stock"
                    ? `Stock — ${mode.model.name}`
                    : mode.kind === "inspections"
                      ? `Inspections — ${mode.model.name}`
                      : `Edit ${mode.model.name}`}
            </DialogTitle>
            <DialogDescription>
              The product a piece of gear is — "BD HotForge 12cm". Everything
              true of every unit lives here: brand, MSRP, service life, and
              whether the cave tracks them individually or by count.
            </DialogDescription>
          </DialogHeader>

          {mode.kind === "list" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="models-type">Type</Label>
                <NativeSelect
                  id="models-type"
                  className="w-full"
                  value={typePublicId}
                  onChange={(e) => setTypePublicId(e.target.value)}
                >
                  <option value="">All types</option>
                  {(types ?? []).map((t) => (
                    <option key={t.publicId} value={t.publicId}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <ListPane
                models={models ?? []}
                isLoading={isLoading}
                canCreate={typePublicId.length > 0}
                scoped={typePublicId.length > 0}
                onCreate={() => setMode({ kind: "create" })}
                onEdit={(model) => setMode({ kind: "edit", model })}
                onEditStock={(model) => setMode({ kind: "stock", model })}
                onInspect={(model) => setMode({ kind: "inspections", model })}
                onDelete={(model) => {
                  setDeleteError(null);
                  setPendingDelete(model);
                }}
              />
            </div>
          ) : mode.kind === "inspections" ? (
            <InspectionsPane model={mode.model} />
          ) : mode.kind === "stock" ? (
            <StockPane
              model={mode.model}
              onDone={() => setMode({ kind: "list" })}
            />
          ) : (
            <FormPane
              mode={mode}
              typePublicId={
                mode.kind === "edit" ? mode.model.type.publicId : typePublicId
              }
              onDone={() => setMode({ kind: "list" })}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Only possible while no gear references it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                onConfirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ListPane({
  models,
  isLoading,
  onCreate,
  onEdit,
  onEditStock,
  onInspect,
  onDelete,
  canCreate,
  scoped,
}: {
  models: GearModelSummaryDto[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (model: GearModelSummaryDto) => void;
  onEditStock: (model: GearModelSummaryDto) => void;
  onInspect: (model: GearModelSummaryDto) => void;
  onDelete: (model: GearModelSummaryDto) => void;
  /** A new model needs a type to hang off, so creating still wants one
   *  picked even though browsing no longer does. */
  canCreate: boolean;
  scoped: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isLoading
            ? ""
            : `${models.length} ${models.length === 1 ? "model" : "models"}`}
        </p>
        <Button size="sm" onClick={onCreate} disabled={!canCreate}>
          <Plus className="size-4" />
          New model
        </Button>
      </div>
      {!canCreate ? (
        <p className="text-xs text-muted-foreground">
          Pick a type to add a model to it.
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : models.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {scoped ? "No models under this type yet." : "No models yet."}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="max-h-[45vh] space-y-2 overflow-y-auto">
          {models.map((model) => (
            <li key={model.publicId}>
              <Item variant="outline" size="sm">
                <ItemContent>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {model.manufacturer ? `${model.manufacturer} ` : ""}
                      {model.name}
                    </span>
                    <Badge variant="outline">
                      {TRACKING_LABEL[model.tracking]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      // Counted models lead with what's in the bin:
                      // it's the number an officer opened this dialog
                      // to check, and the one the item list can't show
                      // because there are no item rows to count.
                      model.tracking === "counted" ? stockSummary(model) : null,
                      model.msrpCents !== null
                        ? `$${(model.msrpCents / 100).toFixed(2)}`
                        : null,
                      model.serviceLifeYears !== null
                        ? `${model.serviceLifeYears} yr service life`
                        : null,
                      model.effectiveInspectionIntervalDays !== null
                        ? `inspect every ${model.effectiveInspectionIntervalDays} days`
                        : null,
                      ...model.attributes.map(
                        (a) => `${a.label}: ${a.text ?? a.number}`,
                      ),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ") || "No details recorded."}
                  </p>
                </ItemContent>
                <ItemActions>
                  {model.tracking === "counted" ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEditStock(model)}
                        aria-label={`Stock for ${model.name}`}
                      >
                        <Boxes className="size-4" />
                      </Button>
                      {/* Counted gear is inspected as a batch, so this
                       * is the only door to its inspection log — a
                       * coded model's pieces each have their own on
                       * the detail page. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onInspect(model)}
                        aria-label={`Inspections for ${model.name}`}
                      >
                        <ClipboardCheck className="size-4" />
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(model)}
                    aria-label="Edit"
                  >
                    <Edit className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(model)}
                    aria-label="Delete"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dollars in the form, cents on the wire. Blank means "not recorded",
 *  which is a different thing from zero and has to survive as null. */
function centsToDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number | null {
  const trimmed = dollars.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function optionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function FormPane({
  mode,
  typePublicId,
  onDone,
}: {
  mode: { kind: "create" } | { kind: "edit"; model: GearModelSummaryDto };
  typePublicId: string;
  onDone: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const existing = isEdit ? mode.model : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [manufacturer, setManufacturer] = useState(
    existing?.manufacturer ?? "",
  );
  const [tracking, setTracking] = useState<GearTracking>(
    existing?.tracking ?? "coded",
  );
  const [msrp, setMsrp] = useState(centsToDollars(existing?.msrpCents ?? null));
  const [serviceLifeYears, setServiceLifeYears] = useState(
    existing?.serviceLifeYears === null || existing === null
      ? ""
      : String(existing.serviceLifeYears),
  );
  const [inspectionIntervalDays, setInspectionIntervalDays] = useState(
    existing?.inspectionIntervalDays === null || existing === null
      ? ""
      : String(existing.inspectionIntervalDays),
  );
  const [productUrl, setProductUrl] = useState(existing?.productUrl ?? "");
  const [attributes, setAttributes] = useState<AttributeFormValues>(
    existing
      ? attributeFormValuesFrom(
          existing.attributes,
          new Set(existing.attributes.map((a) => a.defPublicId)),
        )
      : {},
  );
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateGearModel();
  const updateMutation = useUpdateGearModel();
  const pending = createMutation.isPending || updateMutation.isPending;

  const messageFor = (result: { reason: string; message?: string }) =>
    result.reason === "invalid_attribute"
      ? (result.message ?? "That attribute value isn't valid.")
      : result.reason === "name_in_use"
        ? "A model with that name already exists for this type."
        : result.reason === "has_items"
          ? "This model already has gear under it, so it can't become a counted model. Retire or move those pieces first."
          : "Pick a type first.";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload = {
      name: name.trim(),
      manufacturer:
        manufacturer.trim().length === 0 ? null : manufacturer.trim(),
      tracking,
      description: null,
      msrpCents: dollarsToCents(msrp),
      serviceLifeYears: optionalInt(serviceLifeYears),
      inspectionIntervalDays: optionalInt(inspectionIntervalDays),
      productUrl: productUrl.trim().length === 0 ? null : productUrl.trim(),
      attributes: attributeInputsFrom(attributes),
    };
    if (isEdit && existing) {
      updateMutation.mutate(
        // No `typePublicId`: the edit form doesn't offer a type change,
        // and the action doesn't support one.
        { publicId: existing.publicId, ...payload },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success(`Saved ${payload.name}`);
              onDone();
              return;
            }
            setError(messageFor(result));
          },
          onError: () => setError("Couldn't save the model."),
        },
      );
      return;
    }
    createMutation.mutate(
      { typePublicId, ...payload },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Created ${payload.name}`);
            onDone();
            return;
          }
          setError(messageFor(result));
        },
        onError: () => setError("Couldn't create the model."),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset
        disabled={pending}
        className="max-h-[55vh] space-y-4 overflow-y-auto border-0"
      >
        {/* Manufacturer first: the name is the model proper, so the
         * pair reads the way it is spoken and printed — "Black Diamond
         * HotForge 12cm" — and the way every list renders it. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="model-manufacturer">Manufacturer</Label>
            <Input
              id="model-manufacturer"
              autoFocus
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              maxLength={100}
              placeholder="Black Diamond"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-name">Name</Label>
            <Input
              id="model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="HotForge 12cm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="model-tracking">Tracking</Label>
          <NativeSelect
            id="model-tracking"
            className="w-full"
            value={tracking}
            onChange={(e) => setTracking(e.target.value as GearTracking)}
          >
            {GEAR_TRACKING_VALUES.map((value) => (
              <option key={value} value={value}>
                {TRACKING_LABEL[value]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Counted models have no individual pieces — the cave hands out six
            draws and counts six back. A model that already has gear under it
            can't be switched to counted.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="model-msrp">MSRP</Label>
            <Input
              id="model-msrp"
              inputMode="decimal"
              value={msrp}
              onChange={(e) => setMsrp(e.target.value)}
              placeholder="24.95"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-service-life">Service life</Label>
            <Input
              id="model-service-life"
              type="number"
              min={1}
              max={100}
              value={serviceLifeYears}
              onChange={(e) => setServiceLifeYears(e.target.value)}
              placeholder="10"
            />
            <p className="text-xs text-muted-foreground">
              Years from manufacture.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-inspection">Inspect every</Label>
            <Input
              id="model-inspection"
              type="number"
              min={1}
              max={3650}
              value={inspectionIntervalDays}
              onChange={(e) => setInspectionIntervalDays(e.target.value)}
              placeholder="180"
            />
            <p className="text-xs text-muted-foreground">
              Days. Blank inherits the type's cadence.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="model-url">Product page</Label>
          <Input
            id="model-url"
            type="url"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            maxLength={500}
            placeholder="https://…"
          />
        </div>

        <GearAttributeFields
          typePublicId={typePublicId || null}
          level="model"
          values={attributes}
          onChange={setAttributes}
          idPrefix="model"
        />

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || name.trim().length === 0}>
          {isEdit ? "Save" : "Create model"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Quantity in a bucket, defaulting to zero: a missing row and a zero
 *  row mean the same thing, and the editor shouldn't make the officer
 *  care which one the database happens to hold. */
function quantityOf(model: GearModelSummaryDto, condition: GearCondition) {
  return model.stock.find((s) => s.condition === condition)?.quantity ?? 0;
}

function stockSummary(model: GearModelSummaryDto): string {
  const parts = GEAR_CONDITION_VALUES.filter(
    (condition) => quantityOf(model, condition) > 0,
  ).map(
    (condition) =>
      `${quantityOf(model, condition)} ${CONDITION_LABEL[condition].toLowerCase()}`,
  );
  return parts.length === 0 ? "No stock recorded" : parts.join(" · ");
}

/**
 * The counted model's stock editor.
 *
 * Absolute quantities, one box per condition bucket, because that is
 * the shape the answer arrives in: somebody counts the bin and types
 * what they saw. Deltas would make them do the arithmetic the database
 * is better at.
 *
 * `On loan` is read-only and deliberately shown: stock counts every unit
 * the club owns, units out with members included, so "38 serviceable"
 * with six out means 32 on the shelf. Without the second number the
 * first one reads as a shelf count and the save refusal below it looks
 * arbitrary.
 */
function StockPane({
  model,
  onDone,
}: {
  model: GearModelSummaryDto;
  onDone: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<GearCondition, string>>(
    () =>
      Object.fromEntries(
        GEAR_CONDITION_VALUES.map((condition) => [
          condition,
          String(quantityOf(model, condition)),
        ]),
      ) as Record<GearCondition, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetGearModelStock();

  const parsed = GEAR_CONDITION_VALUES.map((condition) => ({
    condition,
    quantity: Number(quantities[condition]),
  }));
  const allValid = parsed.every(
    (row) => Number.isInteger(row.quantity) && row.quantity >= 0,
  );
  const total = allValid
    ? parsed.reduce((sum, row) => sum + row.quantity, 0)
    : 0;
  const serviceable = allValid
    ? (parsed.find((row) => row.condition === "serviceable")?.quantity ?? 0)
    : 0;
  const takeable = Math.max(0, serviceable - model.onLoan - model.onHold);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!allValid) {
      setError("Quantities must be whole numbers, zero or more.");
      return;
    }
    mutation.mutate(
      { publicId: model.publicId, stock: parsed },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Saved stock for ${model.name}`);
            onDone();
            return;
          }
          setError(
            result.reason === "below_on_loan"
              ? `${result.onLoan} ${result.onLoan === 1 ? "unit is" : "units are"} out on loan, so the serviceable count can't go below that. Check those in first, or write them off at check-in.`
              : result.reason === "not_counted"
                ? "This model tracks its units individually, so its count comes from those pieces."
                : "That model no longer exists.",
          );
        },
        onError: () => setError("Couldn't save the stock."),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={mutation.isPending} className="space-y-4 border-0">
        <div className="space-y-2">
          {GEAR_CONDITION_VALUES.map((condition) => (
            <div
              key={condition}
              className="flex items-center justify-between gap-3"
            >
              <Label htmlFor={`stock-${condition}`} className="font-normal">
                {CONDITION_LABEL[condition]}
              </Label>
              <Input
                id={`stock-${condition}`}
                type="number"
                min={0}
                max={10_000}
                inputMode="numeric"
                className="w-24"
                value={quantities[condition]}
                onChange={(e) =>
                  setQuantities((prev) => ({
                    ...prev,
                    [condition]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>

        <dl className="space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Total owned</dt>
            <dd className="tabular-nums">{total}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Out on loan</dt>
            <dd className="tabular-nums">{model.onLoan}</dd>
          </div>
          {model.onHold > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Held</dt>
              <dd className="tabular-nums">{model.onHold}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 font-medium">
            <dt>Takeable now</dt>
            <dd className="tabular-nums">{takeable}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          Counts every unit the club owns, including the ones out with members.
          Moving units between buckets is how a repair is recorded — they don't
          appear or vanish.
        </p>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          Save stock
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * A counted model's inspection log.
 *
 * "Looked over all the draws" is recorded against the model, because a
 * counted model has no item rows to hang it on — the `gear_inspections`
 * row has carried a `model_id` from the start, and until now nothing
 * could write one, so slings and draws were the one category of gear
 * with no inspection record at all.
 */
function InspectionsPane({ model }: { model: GearModelSummaryDto }) {
  const [logOpen, setLogOpen] = useState(false);
  const { data, isLoading } = useQuery(
    gearModelInspectionsQueryOptions(model.publicId),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          The whole batch, checked at once.
        </p>
        <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
          <Plus className="size-4" />
          Log inspection
        </Button>
      </div>
      <div className="max-h-[45vh] overflow-y-auto">
        <GearInspectionList inspections={data ?? []} isLoading={isLoading} />
      </div>
      <GearInspectionFormDialog
        target={{ kind: "model", publicId: model.publicId }}
        label={
          model.manufacturer
            ? `${model.manufacturer} ${model.name}`
            : model.name
        }
        open={logOpen}
        onOpenChange={setLogOpen}
      />
    </div>
  );
}
