import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
} from "#/features/auth/api/use-attest-waiver";
import { waiverPendingQueueQueryOptions } from "#/features/auth/api/waiver-queries";
import type { MemberNeedingAttestation } from "#/features/auth/server/waiver-fns";

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

  const toggle = (userId: string) => {
    const next = new Set(selected);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === queue.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(queue.map((m) => m.userId)));
    }
  };

  const onAttestOne = (userId: string, label: string) => {
    attest.mutate(
      { userId },
      {
        onSuccess: () => {
          toast.success(`Marked ${label} attested`);
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

  const allSelected = selected.size === queue.length && queue.length > 0;
  const someSelected = selected.size > 0;

  return (
    <Card>
      <CardContent className="space-y-4">
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
