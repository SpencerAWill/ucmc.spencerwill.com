import { AlertTriangle, X } from "lucide-react";

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
import { Textarea } from "#/components/ui/textarea";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearLookupRow,
} from "#/features/gear/server/gear-fns";

const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

/** Common row chrome for both modes — gear preview + remove control.
 *  Mode-specific controls (duration vs condition/notes) are rendered
 *  as children. */
function RowFrame({
  row,
  error,
  onRemove,
  children,
}: {
  row: GearLookupRow;
  error?: string | null;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{row.code}</span>
            <span className="text-xs text-muted-foreground">
              {row.typeName}
            </span>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {row.description}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Remove ${row.code}`}
        >
          <X className="size-4" />
        </Button>
      </div>
      {children}
      {error ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CheckoutItemRow({
  row,
  durationDays,
  onDurationChange,
  error,
  onRemove,
}: {
  row: GearLookupRow;
  durationDays: number;
  onDurationChange: (days: number) => void;
  error?: string | null;
  onRemove: () => void;
}) {
  return (
    <RowFrame row={row} error={error} onRemove={onRemove}>
      <div className="mt-2 flex items-center gap-2">
        <Label
          htmlFor={`duration-${row.publicId}`}
          className="text-xs text-muted-foreground"
        >
          Due in
        </Label>
        <Input
          id={`duration-${row.publicId}`}
          type="number"
          min={1}
          max={90}
          value={durationDays}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onDurationChange(n);
          }}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">days</span>
      </div>
    </RowFrame>
  );
}

export function CheckinItemRow({
  row,
  conditionAtReturn,
  onConditionChange,
  notes,
  onNotesChange,
  error,
  onRemove,
}: {
  row: GearLookupRow;
  conditionAtReturn: GearCondition | null;
  onConditionChange: (condition: GearCondition | null) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  error?: string | null;
  onRemove: () => void;
}) {
  return (
    <RowFrame row={row} error={error} onRemove={onRemove}>
      <div className="mt-3 grid gap-2 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1">
          <Label
            htmlFor={`condition-${row.publicId}`}
            className="text-xs text-muted-foreground"
          >
            Condition at return
          </Label>
          <Select
            value={conditionAtReturn ?? "__unchanged__"}
            onValueChange={(v) =>
              onConditionChange(
                v === "__unchanged__" ? null : (v as GearCondition),
              )
            }
          >
            <SelectTrigger id={`condition-${row.publicId}`} className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unchanged__">No change</SelectItem>
              {GEAR_CONDITION_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={`notes-${row.publicId}`}
            className="text-xs text-muted-foreground"
          >
            Notes (optional)
          </Label>
          <Textarea
            id={`notes-${row.publicId}`}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={1}
            maxLength={2000}
          />
        </div>
      </div>
    </RowFrame>
  );
}
