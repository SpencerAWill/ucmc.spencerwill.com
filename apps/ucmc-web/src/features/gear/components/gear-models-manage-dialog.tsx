/**
 * Officer-facing model manager — the product layer's own surface.
 *
 * Until now a model could only be created inline from the add-gear
 * sheet, with a name and a manufacturer; MSRP, service life, inspection
 * cadence and the model-level attributes had no editor at all. Those
 * are the fields the model layer was introduced for, so leaving them
 * unwritable made the layer decorative.
 *
 * Scoped by type rather than listing every model at once, matching the
 * picker in the gear sheet: models only mean anything under a type, and
 * a flat list of every product the club owns is a scrolling exercise.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit, Plus, Trash2 } from "lucide-react";
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
  gearModelsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { useCreateGearModel } from "#/features/gear/api/use-create-gear-model";
import { useDeleteGearModel } from "#/features/gear/api/use-delete-gear-model";
import { useUpdateGearModel } from "#/features/gear/api/use-update-gear-model";
import {
  GearAttributeFields,
  attributeFormValuesFrom,
  attributeInputsFrom,
} from "#/features/gear/components/gear-attribute-fields";
import type { AttributeFormValues } from "#/features/gear/components/gear-attribute-fields";
import { TRACKING_LABEL } from "#/features/gear/lib/labels";
import { GEAR_TRACKING_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearModelSummaryDto,
  GearTracking,
} from "#/features/gear/server/gear-fns";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; model: GearModelSummaryDto };

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
  const { data: models, isLoading } = useQuery({
    ...gearModelsQueryOptions(typePublicId || null),
    enabled: typePublicId.length > 0,
  });
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
                  <option value="">Pick a type…</option>
                  {(types ?? []).map((t) => (
                    <option key={t.publicId} value={t.publicId}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {typePublicId.length === 0 ? null : (
                <ListPane
                  models={models ?? []}
                  isLoading={isLoading}
                  onCreate={() => setMode({ kind: "create" })}
                  onEdit={(model) => setMode({ kind: "edit", model })}
                  onDelete={(model) => {
                    setDeleteError(null);
                    setPendingDelete(model);
                  }}
                />
              )}
            </div>
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
  onDelete,
}: {
  models: GearModelSummaryDto[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (model: GearModelSummaryDto) => void;
  onDelete: (model: GearModelSummaryDto) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          New model
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : models.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No models under this type yet.</EmptyTitle>
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
