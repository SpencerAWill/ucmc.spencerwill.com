import { AlertTriangle, X } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "#/components/ui/item";
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

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Common chrome for a row in either pane — gear preview + remove
 * affordance, with mode-specific controls hung below as children. The
 * outer wrapper is the shadcn `Item` primitive so the row matches
 * the gear-list / type-management visual language elsewhere in this
 * feature.
 */
function ItemFrame({
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
    <Item variant="outline" className="flex-col items-stretch">
      <div className="flex w-full items-start gap-3">
        <ItemContent>
          <ItemTitle>
            <span className="font-mono">{row.code}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {row.typeName}
            </span>
          </ItemTitle>
          <ItemDescription className="line-clamp-2">
            {row.description}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove ${row.code}`}
          >
            <X className="size-4" />
          </Button>
        </ItemActions>
      </div>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="size-3" />
          {error}
        </p>
      ) : null}
    </Item>
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
  // Anchor the date math at midnight local-time so the round-trip
  // (date → days → date) stays stable through the day. The server
  // re-derives the dueAt from `durationDays` relative to its own
  // clock at submit time; a submission right at midnight could drift
  // a day, which is fine for a desk that doesn't operate then.
  const today = startOfDay(new Date());
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + durationDays);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 90);
  return (
    <ItemFrame row={row} error={error} onRemove={onRemove}>
      <div className="flex items-center gap-2">
        <Label
          htmlFor={`due-${row.publicId}`}
          className="text-xs text-muted-foreground"
        >
          Due
        </Label>
        <Input
          id={`due-${row.publicId}`}
          type="date"
          // `min = today` so exec can run a same-day loan (gear out
          // for a meeting, returned that evening). Past dates are
          // rejected by the input attribute AND the onChange filter
          // below; the server caps at 0..90 days too.
          min={toIsoDate(today)}
          max={toIsoDate(maxDate)}
          value={toIsoDate(dueDate)}
          onChange={(e) => {
            const [y, m, d] = e.target.value
              .split("-")
              .map((n) => Number.parseInt(n, 10));
            if (
              !Number.isFinite(y) ||
              !Number.isFinite(m) ||
              !Number.isFinite(d)
            ) {
              return;
            }
            const picked = startOfDay(new Date(y, m - 1, d));
            const diffMs = picked.getTime() - today.getTime();
            const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
            if (days >= 0 && days <= 90) onDurationChange(days);
          }}
          className="h-8 w-auto"
        />
        <span className="text-xs text-muted-foreground">
          {durationDays === 0
            ? "(same day)"
            : `(${durationDays} ${durationDays === 1 ? "day" : "days"})`}
        </span>
      </div>
    </ItemFrame>
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
    <ItemFrame row={row} error={error} onRemove={onRemove}>
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
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
    </ItemFrame>
  );
}
