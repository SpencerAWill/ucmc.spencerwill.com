import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { WAIVER_VERSION } from "#/config/legal";
import { currentWaiverCycle } from "#/config/waiver-cycle";
import { requirePermission } from "#/features/auth/guards";
import {
  useAttestWaiver,
  useBulkAttestWaivers,
} from "#/features/waivers/api/use-attest-waiver";
import { waiverPendingQueueQueryOptions } from "#/features/waivers/api/queries";
import { BULK_ATTEST_MAX } from "#/features/waivers/server/waiver-fns";
import type { MemberNeedingAttestation } from "#/features/waivers/server/waiver-fns";

/**
 * Officer queue of approved members without a current-cycle paper-waiver
 * attestation. Officers (Treasurer + President) collect signed papers
 * at meetings, then come here to mark members attested. Bulk-select +
 * "Attest selected" handles the start-of-season stack of papers.
 *
 * The signed PDF is never uploaded — only the metadata that an officer
 * confirmed receipt is stored. See `waiver-actions.server.ts` for the
 * data model and rationale (Bylaw 1.3 keeps medical PII off-platform).
 */
export const Route = createFileRoute("/members/waivers")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "waivers:verify");
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(waiverPendingQueueQueryOptions()),
  component: WaiversQueuePage,
});

function WaiversQueuePage() {
  const cycle = currentWaiverCycle();
  const { data: queue } = useSuspenseQuery(waiverPendingQueueQueryOptions());

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Waiver attestations</h1>
        <p className="text-sm text-muted-foreground">
          Members below are approved but lack a current-cycle attestation. Mark
          a member attested after you receive their signed paper waiver.
        </p>
        <p className="text-xs text-muted-foreground">
          Cycle <code>{cycle}</code> · Waiver version{" "}
          <code>{WAIVER_VERSION}</code>
        </p>
      </header>

      {queue.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nobody needs attestation right now.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <QueueTable queue={queue} />
      )}
    </div>
  );
}

function QueueTable({ queue }: { queue: MemberNeedingAttestation[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNotes, setBulkNotes] = useState("");

  const attest = useAttestWaiver();
  const bulkAttest = useBulkAttestWaivers();

  // The "selectable set" is the first BULK_ATTEST_MAX rows of the
  // queue — server-side bulk attestation tops out there, and
  // "select all" should never build a request the server will reject.
  // Recomputed when `queue` changes so it stays in sync with the
  // current ordering.
  const selectableIds = useMemo(
    () => queue.slice(0, BULK_ATTEST_MAX).map((m) => m.userId),
    [queue],
  );

  // When `queue` updates (after a successful mutation refetch),
  // members that were just attested fall off the queue. Drop them
  // from `selected` so a follow-up bulk attest doesn't include
  // already-processed IDs (which would create duplicate attestations).
  useEffect(() => {
    setSelected((prev) => {
      const queueIds = new Set(queue.map((m) => m.userId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (queueIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [queue]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
        return next;
      }
      // Refuse to grow `selected` past the server's bulk cap. This
      // mirrors the "Select all" cap (which selects exactly the first
      // BULK_ATTEST_MAX rows) and keeps the UI from ever building a
      // request the validator will reject.
      if (next.size >= BULK_ATTEST_MAX) {
        toast.error(
          `Bulk attestation is capped at ${BULK_ATTEST_MAX} per request.`,
        );
        return prev;
      }
      next.add(userId);
      return next;
    });
  };

  // `allSelected` reflects whether every selectable row is currently
  // selected — not merely the count. The count-based check would tick
  // the box even when an officer manually selected a different 200 rows
  // outside the selectable set.
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  };

  const onAttestOne = (userId: string, label: string) => {
    attest.mutate(
      { userId },
      {
        onSuccess: () => {
          toast.success(`Marked ${label} attested`);
          // Drop the just-attested member from `selected` so a later
          // bulk submit doesn't re-include them via stale state. The
          // queue refetch also prunes them on next render, but
          // updating state immediately keeps the UI consistent
          // before the refetch lands.
          setSelected((prev) => {
            if (!prev.has(userId)) {
              return prev;
            }
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Attestation failed",
          );
        },
      },
    );
  };

  const onAttestSelected = () => {
    if (selected.size === 0) {
      return;
    }
    const userIds = [...selected];
    bulkAttest.mutate(
      { userIds, notes: bulkNotes.trim() || undefined },
      {
        onSuccess: ({ count }) => {
          toast.success(`Attested ${count} member${count === 1 ? "" : "s"}`);
          setSelected(new Set());
          setBulkNotes("");
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Bulk attestation failed",
          );
        },
      },
    );
  };

  const someSelected = selected.size > 0;
  const queueExceedsCap = queue.length > BULK_ATTEST_MAX;

  return (
    <Card>
      <CardContent className="space-y-4">
        {queueExceedsCap ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {queue.length} members are pending attestation. &quot;Select
            all&quot; will pick the {BULK_ATTEST_MAX} oldest entries; bulk
            attestations are capped at {BULK_ATTEST_MAX} per request.
          </p>
        ) : null}
        {/* Bulk action bar — visible only when something is selected. */}
        {someSelected ? (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="bulk-notes" className="text-xs">
                Optional note (applied to all selected attestations)
              </Label>
              <Input
                id="bulk-notes"
                value={bulkNotes}
                onChange={(e) => setBulkNotes(e.target.value)}
                placeholder="e.g. collected at 9/2 fall kickoff"
                maxLength={500}
              />
            </div>
            <Button onClick={onAttestSelected} disabled={bulkAttest.isPending}>
              {bulkAttest.isPending
                ? "Attesting..."
                : `Attest ${selected.size} selected`}
            </Button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-2 py-2 text-left">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Name
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Affiliation
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Approved
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.map((member) => {
                const label =
                  member.preferredName ?? member.fullName ?? member.email;
                return (
                  <tr key={member.userId} className="border-b last:border-0">
                    <td className="px-2 py-3">
                      <Checkbox
                        aria-label={`Select ${label}`}
                        checked={selected.has(member.userId)}
                        onCheckedChange={() => toggle(member.userId)}
                      />
                    </td>
                    <td className="px-2 py-3">
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">
                        {member.email}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {member.ucAffiliation ? (
                        <Badge variant="outline">{member.ucAffiliation}</Badge>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {member.approvedAt
                        ? new Date(member.approvedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onAttestOne(member.userId, label)}
                        disabled={attest.isPending}
                      >
                        Attest
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
