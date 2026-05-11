import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";
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
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
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
      <SheetContent className="flex flex-col gap-0">
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
    const payload = {
      typePublicId,
      code: code.trim().length === 0 ? null : code.trim(),
      description: trimmedDescription,
      acquiredAt: acquiredAtMs,
      acquisitionCostCents: cents,
      notesMarkdown: notes.trim().length === 0 ? null : notes,
      condition,
      tagPublicIds,
    };

    if (isEdit) {
      editMutation.mutate(
        { publicId: intent.gear.publicId, ...payload },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success("Gear updated");
              onClose();
            } else {
              setError(`Code "${result.code}" is already in use.`);
            }
          },
          onError: () => setError("Couldn't save changes."),
        },
      );
      return;
    }
    createMutation.mutate(payload, {
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
    });
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
        <div className="space-y-1.5">
          <Label htmlFor="gear-condition">Condition</Label>
          <Select
            value={condition}
            onValueChange={(v) => setCondition(v as GearCondition)}
          >
            <SelectTrigger id="gear-condition">
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
