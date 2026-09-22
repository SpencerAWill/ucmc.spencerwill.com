/**
 * Officer-facing attribute-definition manager: the surface where the
 * cave's own vocabulary gets written down.
 *
 * Same list/form-pane shell as the types and tags dialogs, with three
 * behaviours specific to definitions:
 *
 *   - `kind` and `level` are set once and then shown read-only. Both
 *     are immutable server-side, and a disabled control that explains
 *     why beats a control that silently fails on save.
 *   - Deleting is refused while answers exist. Archiving is offered in
 *     the same row, because it is almost always what was meant.
 *   - A definition attached to no type is flagged. It is legal — you
 *     may define before you attach — but it appears on no form, and
 *     silence there looks like a bug in the form, not a gap here.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Edit,
  Plus,
  Trash2,
  X,
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
import { Checkbox } from "#/components/ui/checkbox";
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
import { Switch } from "#/components/ui/switch";
import {
  gearAttributeDefsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { useCreateGearAttribute } from "#/features/gear/api/use-create-gear-attribute";
import { useDeleteGearAttribute } from "#/features/gear/api/use-delete-gear-attribute";
import { useUpdateGearAttribute } from "#/features/gear/api/use-update-gear-attribute";
import {
  ATTRIBUTE_KIND_LABEL,
  ATTRIBUTE_LEVEL_LABEL,
  ATTRIBUTE_LEVEL_HINT,
} from "#/features/gear/lib/labels";
import type {
  GearAttributeDefSummary,
  GearAttributeKind,
  GearAttributeLevel,
  GearTypeSummary,
} from "#/features/gear/server/gear-fns";
import {
  GEAR_ATTRIBUTE_KIND_VALUES,
  GEAR_ATTRIBUTE_LEVEL_VALUES,
} from "#/features/gear/server/gear-fns";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; def: GearAttributeDefSummary };

export function GearAttributesManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [pendingDelete, setPendingDelete] =
    useState<GearAttributeDefSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data, isLoading } = useQuery(
    gearAttributeDefsQueryOptions({ includeArchived: true }),
  );
  const { data: types } = useQuery(gearTypesQueryOptions());
  const deleteMutation = useDeleteGearAttribute();
  const updateMutation = useUpdateGearAttribute();

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteMutation.mutate(
      { publicId: target.publicId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Deleted ${target.label}`);
            setPendingDelete(null);
            setDeleteError(null);
            return;
          }
          setDeleteError(
            result.reason === "has_values"
              ? `${target.label} has ${result.valueCount} recorded ${
                  result.valueCount === 1 ? "answer" : "answers"
                }. Archive it instead — that hides it from the forms and keeps what's been recorded.`
              : "That attribute no longer exists.",
          );
        },
        onError: () => setDeleteError("Couldn't delete the attribute."),
      },
    );
  };

  const onToggleArchived = (def: GearAttributeDefSummary) => {
    updateMutation.mutate(
      { publicId: def.publicId, archived: !def.archived },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(
              def.archived
                ? `${def.label} is back on the forms`
                : `${def.label} archived`,
            );
          }
        },
        onError: () => toast.error("Couldn't change the attribute."),
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
                  aria-label="Back to attributes"
                >
                  <ArrowLeft className="size-4" />
                </Button>
              ) : null}
              {mode.kind === "list"
                ? "Gear attributes"
                : mode.kind === "create"
                  ? "New attribute"
                  : `Edit ${mode.def.label}`}
            </DialogTitle>
            <DialogDescription>
              Per-type properties — rope diameter, harness size, stove fuel.
              Attach each one to the types it applies to; it then appears on
              those forms and as a filter on the gear page.
            </DialogDescription>
          </DialogHeader>

          {mode.kind === "list" ? (
            <ListPane
              defs={data ?? []}
              types={types ?? []}
              isLoading={isLoading}
              onCreate={() => setMode({ kind: "create" })}
              onEdit={(def) => setMode({ kind: "edit", def })}
              onDelete={(def) => {
                setDeleteError(null);
                setPendingDelete(def);
              }}
              onToggleArchived={onToggleArchived}
            />
          ) : (
            <FormPane
              mode={mode}
              types={types ?? []}
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
            <AlertDialogTitle>Delete {pendingDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the attribute from every form and filter. Only possible
              while nothing has been recorded against it.
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
  defs,
  types,
  isLoading,
  onCreate,
  onEdit,
  onDelete,
  onToggleArchived,
}: {
  defs: GearAttributeDefSummary[];
  types: GearTypeSummary[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (def: GearAttributeDefSummary) => void;
  onDelete: (def: GearAttributeDefSummary) => void;
  onToggleArchived: (def: GearAttributeDefSummary) => void;
}) {
  const typeName = new Map(types.map((t) => [t.publicId, t.name]));
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          New attribute
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : defs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              No attributes yet. Rope diameter and harness size are the usual
              first two.
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {defs.map((def) => (
            <li key={def.publicId}>
              <Item variant="outline" size="sm">
                <ItemContent>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{def.label}</span>
                    <Badge variant="secondary">
                      {ATTRIBUTE_LEVEL_LABEL[def.level]}
                    </Badge>
                    <Badge variant="outline">
                      {ATTRIBUTE_KIND_LABEL[def.kind]}
                      {def.unit ? ` · ${def.unit}` : ""}
                    </Badge>
                    {def.required ? (
                      <Badge variant="outline">Required</Badge>
                    ) : null}
                    {def.archived ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {def.typePublicIds.length === 0
                      ? "Not attached to any type — it appears on no form yet."
                      : def.typePublicIds
                          .map((id) => typeName.get(id) ?? "Unknown type")
                          .join(", ")}
                  </p>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onToggleArchived(def)}
                    aria-label={def.archived ? "Restore" : "Archive"}
                  >
                    {def.archived ? (
                      <ArchiveRestore className="size-4" />
                    ) : (
                      <Archive className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(def)}
                    aria-label="Edit"
                  >
                    <Edit className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(def)}
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

function FormPane({
  mode,
  types,
  onDone,
}: {
  mode: { kind: "create" } | { kind: "edit"; def: GearAttributeDefSummary };
  types: GearTypeSummary[];
  onDone: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const existing = isEdit ? mode.def : null;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [kind, setKind] = useState<GearAttributeKind>(existing?.kind ?? "text");
  const [level, setLevel] = useState<GearAttributeLevel>(
    existing?.level ?? "item",
  );
  const [options, setOptions] = useState<string[]>(existing?.options ?? []);
  const [optionDraft, setOptionDraft] = useState("");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [required, setRequired] = useState(existing?.required ?? false);
  const [typePublicIds, setTypePublicIds] = useState<string[]>(
    existing?.typePublicIds ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateGearAttribute();
  const updateMutation = useUpdateGearAttribute();
  const pending = createMutation.isPending || updateMutation.isPending;

  const addOption = () => {
    const value = optionDraft.trim();
    if (value.length === 0 || options.includes(value)) {
      setOptionDraft("");
      return;
    }
    setOptions([...options, value]);
    setOptionDraft("");
  };

  const messageFor = (reason: string) =>
    reason === "needs_options"
      ? "A choice list needs at least one option."
      : reason === "key_in_use"
        ? "Another attribute already uses that name."
        : reason === "not_found"
          ? "That attribute no longer exists."
          : "Name can't be empty.";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isEdit && existing) {
      updateMutation.mutate(
        {
          publicId: existing.publicId,
          label,
          options: existing.kind === "select" ? options : null,
          unit: existing.kind === "number" ? unit : null,
          required,
          typePublicIds,
        },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success(`Saved ${label}`);
              onDone();
              return;
            }
            setError(messageFor(result.reason));
          },
          onError: () => setError("Couldn't save the attribute."),
        },
      );
      return;
    }
    createMutation.mutate(
      {
        label,
        kind,
        level,
        options: kind === "select" ? options : null,
        unit: kind === "number" ? unit : null,
        required,
        typePublicIds,
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Created ${label}`);
            onDone();
            return;
          }
          setError(messageFor(result.reason));
        },
        onError: () => setError("Couldn't create the attribute."),
      },
    );
  };

  const effectiveKind = existing?.kind ?? kind;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset
        disabled={pending}
        className="max-h-[55dvh] space-y-4 overflow-y-auto border-0"
      >
        <div className="space-y-1.5">
          <Label htmlFor="attr-label">Name</Label>
          <Input
            id="attr-label"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder="Rope diameter"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="attr-kind">Kind</Label>
            <NativeSelect
              id="attr-kind"
              className="w-full"
              value={effectiveKind}
              disabled={isEdit}
              onChange={(e) => setKind(e.target.value as GearAttributeKind)}
            >
              {GEAR_ATTRIBUTE_KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {ATTRIBUTE_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
            {isEdit ? (
              <p className="text-xs text-muted-foreground">
                Fixed after creation — every recorded answer is stored in this
                kind's shape.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-level">Applies to</Label>
            <NativeSelect
              id="attr-level"
              className="w-full"
              value={existing?.level ?? level}
              disabled={isEdit}
              onChange={(e) => setLevel(e.target.value as GearAttributeLevel)}
            >
              {GEAR_ATTRIBUTE_LEVEL_VALUES.map((l) => (
                <option key={l} value={l}>
                  {ATTRIBUTE_LEVEL_LABEL[l]}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {ATTRIBUTE_LEVEL_HINT[existing?.level ?? level]}
            </p>
          </div>
        </div>

        {effectiveKind === "number" ? (
          <div className="space-y-1.5">
            <Label htmlFor="attr-unit">Unit</Label>
            <Input
              id="attr-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              maxLength={12}
              placeholder="mm"
            />
            <p className="text-xs text-muted-foreground">
              Printed after the number. Keep it out of the values themselves —
              "9.8" filters by range, "9.8mm" doesn't.
            </p>
          </div>
        ) : null}

        {effectiveKind === "select" ? (
          <div className="space-y-1.5">
            <Label htmlFor="attr-option">
              Options, in the order to show them
            </Label>
            <div className="flex gap-2">
              <Input
                id="attr-option"
                value={optionDraft}
                onChange={(e) => setOptionDraft(e.target.value)}
                maxLength={60}
                placeholder="XS"
                onKeyDown={(e) => {
                  // Enter adds the option rather than submitting the
                  // whole form — otherwise typing a list saves after
                  // the first entry.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOption();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addOption}>
                Add
              </Button>
            </div>
            {options.length > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-1">
                {options.map((option, index) => (
                  <li key={option}>
                    <Badge variant="secondary" className="gap-1">
                      <span className="tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      {option}
                      <button
                        type="button"
                        aria-label={`Remove ${option}`}
                        onClick={() =>
                          setOptions(options.filter((o) => o !== option))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sizes sort the way you type them here, not alphabetically.
              </p>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>Types</Label>
          {types.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No gear types yet — create one first and the attribute can attach
              to it.
            </p>
          ) : (
            <ul className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
              {types.map((t) => (
                <li key={t.publicId} className="flex items-center gap-2">
                  <Checkbox
                    id={`attr-type-${t.publicId}`}
                    checked={typePublicIds.includes(t.publicId)}
                    onCheckedChange={(checked) =>
                      setTypePublicIds(
                        checked === true
                          ? [...typePublicIds, t.publicId]
                          : typePublicIds.filter((id) => id !== t.publicId),
                      )
                    }
                  />
                  <Label
                    htmlFor={`attr-type-${t.publicId}`}
                    className="font-normal"
                  >
                    {t.name}
                  </Label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label htmlFor="attr-required">Required</Label>
            <p className="text-xs text-muted-foreground">
              Blocks saving gear of an attached type until it's answered.
            </p>
          </div>
          <Switch
            id="attr-required"
            checked={required}
            onCheckedChange={setRequired}
          />
        </div>

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
        <Button type="submit" disabled={pending}>
          {isEdit ? "Save" : "Create attribute"}
        </Button>
      </DialogFooter>
    </form>
  );
}
