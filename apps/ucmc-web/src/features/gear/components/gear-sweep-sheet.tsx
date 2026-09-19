/**
 * The inventory-sweep workspace: a Sheet rather than a dialog, because
 * a sweep is a standing session somebody works out of for an hour with
 * a phone in one hand, not a form they fill in and dismiss.
 *
 * Its whole job is to make *recording presence* fast — type or scan a
 * code, it lands, type the next one. Absence is never entered; it is
 * inferred when the sweep closes, and the close report is the only
 * moment the officer is asked to read anything.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Play } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Item, ItemContent } from "#/components/ui/item";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Textarea } from "#/components/ui/textarea";
import {
  gearModelsQueryOptions,
  gearTypesQueryOptions,
  openSweepQueryOptions,
} from "#/features/gear/api/queries";
import { useCloseSweep } from "#/features/gear/api/use-close-sweep";
import { useRecordSweepEntry } from "#/features/gear/api/use-record-sweep-entry";
import { useStartSweep } from "#/features/gear/api/use-start-sweep";
import { formatDateTime } from "#/lib/date-format";
import type {
  CloseSweepResult,
  GearSweepDetail,
} from "#/features/gear/server/gear-fns";

type CloseReport = Extract<CloseSweepResult, { ok: true }>;

export function GearSweepSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Inventory sweep</SheetTitle>
          <SheetDescription>
            Log what's actually in the cave. Anything active that nobody logs —
            and isn't on loan, at the shop, or with an officer — is marked
            missing when the sweep closes.
          </SheetDescription>
        </SheetHeader>
        {open ? <SweepBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SweepBody() {
  const { data: sweep, isLoading } = useQuery(openSweepQueryOptions());
  const [report, setReport] = useState<CloseReport | null>(null);
  const startMutation = useStartSweep();

  if (isLoading) {
    return <p className="px-4 text-sm text-muted-foreground">Loading…</p>;
  }

  if (report !== null) {
    return <CloseReportPane report={report} onDone={() => setReport(null)} />;
  }

  if (!sweep) {
    return (
      <div className="space-y-4 px-4 pb-4">
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No sweep is running.</EmptyTitle>
          </EmptyHeader>
        </Empty>
        <Button
          onClick={() =>
            startMutation.mutate(undefined, {
              onSuccess: (result) => {
                toast.success(
                  result.ok
                    ? "Sweep started"
                    : "Joined the sweep already running",
                );
              },
              onError: () => toast.error("Couldn't start the sweep."),
            })
          }
          disabled={startMutation.isPending}
        >
          <Play className="size-4" />
          Start a sweep
        </Button>
        <p className="text-sm text-muted-foreground">
          One sweep runs at a time, cave-wide. Everyone counting scans into the
          same one — two overlapping counts would each infer absence from the
          other's sightings.
        </p>
      </div>
    );
  }

  return <ActiveSweepPane sweep={sweep} onClosed={setReport} />;
}

function ActiveSweepPane({
  sweep,
  onClosed,
}: {
  sweep: GearSweepDetail;
  onClosed: (report: CloseReport) => void;
}) {
  const [code, setCode] = useState("");
  const [typePublicId, setTypePublicId] = useState("");
  const [modelPublicId, setModelPublicId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const { data: types } = useQuery(gearTypesQueryOptions());
  const { data: models } = useQuery({
    ...gearModelsQueryOptions(typePublicId || null),
    enabled: typePublicId.length > 0,
  });
  const recordMutation = useRecordSweepEntry();
  const closeMutation = useCloseSweep();

  const countedModels = (models ?? []).filter((m) => m.tracking === "counted");

  const messageFor = (reason: string) =>
    reason === "not_found"
      ? "No piece with that code."
      : reason === "item_not_active"
        ? "That piece is retired — worth flagging, but it isn't part of the count."
        : reason === "not_counted"
          ? "That model tracks individual pieces. Log them by code."
          : reason === "no_open_sweep"
            ? "The sweep was closed by someone else."
            : "Pick something to log.";

  const submitCode = () => {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      return;
    }
    setError(null);
    recordMutation.mutate(
      { gearCode: trimmed },
      {
        onSuccess: (result) => {
          if (result.ok) {
            // Cleared and refocused without a toast: at forty pieces a
            // minute a confirmation per scan is noise, and the row
            // appearing in the list below is the confirmation.
            setCode("");
            codeRef.current?.focus();
            return;
          }
          setError(messageFor(result.reason));
        },
        onError: () => setError("Couldn't record that."),
      },
    );
  };

  const submitCount = () => {
    if (modelPublicId.length === 0) {
      return;
    }
    setError(null);
    recordMutation.mutate(
      {
        modelPublicId,
        quantityCounted: Math.max(0, Number(quantity) || 0),
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Counted ${quantity || 0} × ${result.label}`);
            setQuantity("");
            return;
          }
          setError(messageFor(result.reason));
        },
        onError: () => setError("Couldn't record that."),
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ClipboardList className="size-4" />
        Started {formatDateTime(sweep.startedAt)} · {sweep.entryCount} logged
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sweep-code">Log a coded piece</Label>
        <div className="flex gap-2">
          <Input
            id="sweep-code"
            ref={codeRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCode();
              }
            }}
            maxLength={64}
            placeholder="CH93"
          />
          <Button
            type="button"
            variant="outline"
            onClick={submitCode}
            disabled={recordMutation.isPending}
          >
            Log
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter logs it and clears the box. Logging the same piece twice is fine
          — several people work one sweep.
        </p>
      </div>

      <div className="space-y-1.5 rounded-md border p-3">
        <Label>Count a counted model</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <NativeSelect
            className="w-full"
            aria-label="Type"
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
          <NativeSelect
            className="w-full"
            aria-label="Model"
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
        <div className="flex gap-2">
          <Input
            type="number"
            min={0}
            aria-label="How many are in the bin"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="How many in the bin"
          />
          <Button
            type="button"
            variant="outline"
            onClick={submitCount}
            disabled={recordMutation.isPending || modelPublicId.length === 0}
          >
            Count
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A later count replaces an earlier one rather than adding to it — two
          people each counting the whole bin is likelier than two splitting it.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {sweep.entries.length > 0 ? (
        <div className="space-y-2">
          <Label>Logged so far</Label>
          <ul className="space-y-2">
            {sweep.entries.map((entry) => (
              <li key={entry.itemPublicId ?? entry.modelName ?? "row"}>
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <span className="text-sm">
                      {entry.itemCode ??
                        `${entry.quantityCounted} × ${entry.modelName ?? "model"}`}
                    </span>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1.5 border-t pt-4">
        <Label htmlFor="sweep-notes">Closing notes</Label>
        <Textarea
          id="sweep-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Who counted, anything odd…"
        />
        <Button
          className="w-full"
          onClick={() =>
            closeMutation.mutate(
              { notes: notes.trim().length === 0 ? null : notes },
              {
                onSuccess: (result) => {
                  if (result.ok) {
                    onClosed(result);
                    return;
                  }
                  setError("The sweep was closed by someone else.");
                },
                onError: () => setError("Couldn't close the sweep."),
              },
            )
          }
          disabled={closeMutation.isPending}
        >
          <CheckCircle2 className="size-4" />
          Close sweep and mark what's missing
        </Button>
      </div>
    </div>
  );
}

function CloseReportPane({
  report,
  onDone,
}: {
  report: CloseReport;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
      <div className="space-y-2">
        <h3 className="font-medium">
          {report.markedMissing.length === 0
            ? "Everything was accounted for."
            : `${report.markedMissing.length} marked missing`}
        </h3>
        {report.markedMissing.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {report.markedMissing.map((item) => (
              <li key={item.publicId}>
                <span className="font-mono text-xs">{item.code ?? "—"}</span>{" "}
                {item.modelName}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {report.shortfalls.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-medium">Counts that don't add up</h3>
          <p className="text-sm text-muted-foreground">
            Nothing has been written off. A miscount is likelier than a real
            loss, so these are yours to judge.
          </p>
          <ul className="space-y-2">
            {report.shortfalls.map((row) => (
              <li key={row.modelPublicId}>
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.modelName}</span>
                      <Badge variant="destructive">{row.shortfall} short</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.expected} owned · {row.counted} counted ·{" "}
                      {row.onLoan} on loan
                    </p>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button variant="outline" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
