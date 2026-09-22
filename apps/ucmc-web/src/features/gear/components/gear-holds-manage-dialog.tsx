/**
 * Officer-facing holds manager — place a hold on a coded piece or a
 * quantity of a counted model, and release one early.
 *
 * Holds expire on their own, so there is no "clean up" flow here and
 * deliberately no delete: a hold that ran its course is a record of
 * what the cave did with its gear, and the list keeps showing it.
 * Releasing is the only write besides placing.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  gearHoldsQueryOptions,
  gearModelsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { usePlaceGearHold } from "#/features/gear/api/use-place-gear-hold";
import { useReleaseGearHold } from "#/features/gear/api/use-release-gear-hold";
import { CLUB_TIME_ZONE } from "#/config/time";
import { formatDate } from "#/lib/date-format";
import type { GearHoldSummary } from "#/features/gear/server/gear-fns";

type Mode = { kind: "list" } | { kind: "create" };

export function GearHoldsManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const { data: holds, isLoading } = useQuery(gearHoldsQueryOptions());
  const releaseMutation = useReleaseGearHold();

  const onRelease = (hold: GearHoldSummary) => {
    releaseMutation.mutate(
      { publicId: hold.publicId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success("Hold released");
            return;
          }
          toast.error(
            result.reason === "already_released"
              ? "That hold was already released."
              : "That hold no longer exists.",
          );
        },
        onError: () => toast.error("Couldn't release the hold."),
      },
    );
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode({ kind: "list" });
    }
    onOpenChange(next);
  };

  return (
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
                aria-label="Back to holds"
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}
            {mode.kind === "list" ? "Gear holds" : "New hold"}
          </DialogTitle>
          <DialogDescription>
            Keep gear back for a trip without checking it out. Holds expire on
            their own, and an officer can override one at the desk — they block
            softly, unlike an unsafe flag.
          </DialogDescription>
        </DialogHeader>

        {mode.kind === "list" ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setMode({ kind: "create" })}>
                <Plus className="size-4" />
                New hold
              </Button>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (holds ?? []).length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>Nothing is held right now.</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
                {(holds ?? []).map((hold) => (
                  <li key={hold.publicId}>
                    <Item variant="outline" size="sm">
                      <ItemContent>
                        {/* Both halves of the identity. A coded hold used
                            to read "HN07" with no idea what that is, and
                            a counted one "4 × Djinn Axess" with no idea
                            which pieces — each surface showing exactly
                            the half the other was missing. */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {hold.itemCode ? (
                              <>
                                <span className="font-mono">
                                  {hold.itemCode}
                                </span>{" "}
                                · {hold.modelName}
                              </>
                            ) : (
                              `${hold.quantity} × ${hold.modelName}`
                            )}
                          </span>
                          <Badge
                            variant={hold.isLive ? "default" : "secondary"}
                          >
                            {hold.isLive
                              ? "Live"
                              : hold.releasedAt !== null
                                ? "Released"
                                : "Expired"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {hold.reason} · {formatDate(hold.startsAt)} –{" "}
                          {formatDate(hold.endsAt)}
                          {hold.heldByName ? ` · ${hold.heldByName}` : ""}
                        </p>
                      </ItemContent>
                      {hold.releasedAt === null ? (
                        <ItemActions>
                          {/* Labelled, not a bare undo arrow: releasing
                              somebody else's trip reservation is not a
                              guessable icon. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRelease(hold)}
                          >
                            <Undo2 className="size-4" />
                            Release
                          </Button>
                        </ItemActions>
                      ) : null}
                    </Item>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <FormPane onDone={() => setMode({ kind: "list" })} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** `<input type="date">` gives a local calendar date; the hold wants an
 *  instant. Start of day for the opening bound and end of day for the
 *  closing one, both in club time, so "held Friday to Sunday" covers
 *  all of Sunday rather than expiring at midnight on Saturday. */
function dateToInstant(value: string, edge: "start" | "end"): number | null {
  if (value.length === 0) {
    return null;
  }
  try {
    const date = Temporal.PlainDate.from(value);
    const time =
      edge === "start"
        ? new Temporal.PlainTime(0, 0, 0)
        : new Temporal.PlainTime(23, 59, 59, 999);
    return date
      .toZonedDateTime({ timeZone: CLUB_TIME_ZONE, plainTime: time })
      .toInstant().epochMilliseconds;
  } catch {
    return null;
  }
}

function FormPane({ onDone }: { onDone: () => void }) {
  const [subject, setSubject] = useState<"item" | "model">("item");
  const [gearCode, setGearCode] = useState("");
  const [typePublicId, setTypePublicId] = useState("");
  const [modelPublicId, setModelPublicId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: types } = useQuery(gearTypesQueryOptions());
  const { data: models } = useQuery({
    ...gearModelsQueryOptions(typePublicId || null),
    enabled: typePublicId.length > 0,
  });
  const placeMutation = usePlaceGearHold();

  // Only counted models can be held by quantity: a coded model's units
  // are held one at a time, by code.
  const countedModels = (models ?? []).filter((m) => m.tracking === "counted");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const startsAtMs = dateToInstant(startsAt, "start");
    const endsAtMs = dateToInstant(endsAt, "end");
    if (startsAtMs === null || endsAtMs === null) {
      setError("Pick both dates.");
      return;
    }
    placeMutation.mutate(
      {
        ...(subject === "item"
          ? { gearCode }
          : {
              modelPublicId,
              quantity: Math.max(1, Number(quantity) || 1),
            }),
        reason,
        startsAtMs,
        endsAtMs,
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success("Hold placed");
            onDone();
            return;
          }
          setError(
            result.reason === "subject_required"
              ? "Pick a piece or a counted model."
              : result.reason === "empty_reason"
                ? "Say what the hold is for — members see this."
                : result.reason === "bad_window"
                  ? "The end date has to come after the start."
                  : result.reason === "not_counted"
                    ? "That model tracks individual pieces. Hold them by code instead."
                    : result.reason === "item_not_active"
                      ? "That piece is retired."
                      : "No piece with that code.",
          );
        },
        onError: () => setError("Couldn't place the hold."),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset
        disabled={placeMutation.isPending}
        className="max-h-[55dvh] space-y-4 overflow-y-auto border-0"
      >
        <div className="space-y-1.5">
          <Label htmlFor="hold-subject">What's being held</Label>
          <NativeSelect
            id="hold-subject"
            className="w-full"
            value={subject}
            onChange={(e) => setSubject(e.target.value as "item" | "model")}
          >
            <option value="item">One coded piece</option>
            <option value="model">A quantity of a counted model</option>
          </NativeSelect>
        </div>

        {subject === "item" ? (
          <div className="space-y-1.5">
            <Label htmlFor="hold-code">Code</Label>
            <Input
              id="hold-code"
              value={gearCode}
              onChange={(e) => setGearCode(e.target.value)}
              maxLength={64}
              placeholder="CH93"
            />
            <p className="text-xs text-muted-foreground">
              The code on the tag. Case doesn't matter.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="hold-type">Type</Label>
                <NativeSelect
                  id="hold-type"
                  className="w-full"
                  value={typePublicId}
                  onChange={(e) => {
                    setTypePublicId(e.target.value);
                    setModelPublicId("");
                  }}
                >
                  <option value="">Pick a type…</option>
                  {(types ?? []).map((t) => (
                    <option key={t.publicId} value={t.publicId}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hold-model">Model</Label>
                <NativeSelect
                  id="hold-model"
                  className="w-full"
                  value={modelPublicId}
                  onChange={(e) => setModelPublicId(e.target.value)}
                  disabled={typePublicId.length === 0}
                >
                  <option value="">
                    {countedModels.length === 0
                      ? "No counted models here"
                      : "Pick a model…"}
                  </option>
                  {countedModels.map((m) => (
                    <option key={m.publicId} value={m.publicId}>
                      {m.manufacturer ? `${m.manufacturer} ` : ""}
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-quantity">How many</Label>
              <Input
                id="hold-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="hold-reason">Reason</Label>
          <Input
            id="hold-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Red River trip, 14–16 Nov"
          />
          <p className="text-xs text-muted-foreground">
            Members read this on the gear page, so "Red River trip" beats
            "reserved".
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hold-starts">From</Label>
            <Input
              id="hold-starts"
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hold-ends">Until</Label>
            <Input
              id="hold-ends"
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Inclusive — the hold lifts at the end of this day.
            </p>
          </div>
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
        <Button type="submit" disabled={placeMutation.isPending}>
          Place hold
        </Button>
      </DialogFooter>
    </form>
  );
}
