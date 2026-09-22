import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "#/components/layouts/page-container";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { WAIVER_VERSION } from "#/config/legal";
import { formatDate } from "#/lib/date-format";
import { currentWaiverCycle } from "#/config/waiver-cycle";
import {
  requireAnyPermission,
  WAIVER_VIEW_PERMISSIONS,
} from "#/features/auth/guards";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePageFlag } from "#/features/settings/api/page-guards";
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
 * Two permission tiers share this page: `waivers:view` sees the queue
 * read-only (exec who need to answer "is this member covered?" without
 * holding the attestation power), `waivers:verify` additionally gets the
 * selection checkboxes, the bulk bar, and the per-row Attest button.
 *
 * The signed PDF is never uploaded — only the metadata that an officer
 * confirmed receipt is stored. See `waiver-actions.server.ts` for the
 * data model and rationale (Bylaw 1.3 keeps medical PII off-platform).
 */
export const Route = createFileRoute("/members/waivers")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "members_waivers");
    // `waivers:view` opens the queue read-only; the attest controls
    // below are separately gated on `waivers:verify`.
    await requireAnyPermission(context.queryClient, WAIVER_VIEW_PERMISSIONS);
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(waiverPendingQueueQueryOptions()),
  component: WaiversQueuePage,
});

function WaiversQueuePage() {
  const cycle = currentWaiverCycle();
  const { hasPermission } = useAuth();
  const canVerify = hasPermission("waivers:verify");
  const { data: queue } = useSuspenseQuery(waiverPendingQueueQueryOptions());

  return (
    <PageContainer width="wide" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Waiver attestations</h1>
        <p className="text-sm text-muted-foreground">
          Members below are approved but lack a current-cycle attestation.
          {canVerify
            ? " Mark a member attested after you receive their signed paper waiver."
            : " Read-only view — attesting requires the waivers:verify permission."}
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
        <QueueTable queue={queue} canVerify={canVerify} />
      )}
    </PageContainer>
  );
}

function QueueTable({
  queue,
  canVerify,
}: {
  queue: MemberNeedingAttestation[];
  canVerify: boolean;
}) {
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
            {queue.length} members are pending attestation.{" "}
            {canVerify ? (
              <>
                &quot;Select all&quot; will pick the {BULK_ATTEST_MAX} oldest
                entries; bulk attestations are capped at {BULK_ATTEST_MAX} per
                request.
              </>
            ) : null}
          </p>
        ) : null}
        {/* Bulk action bar — visible only when something is selected, which
            can only happen for verifiers (the checkboxes are theirs). */}
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

        {/* Two renderings of one queue, not a table that has been
            squeezed. The table has four data columns plus a checkbox and
            an action; at 390px that is ~55px a column, and the email —
            the thing an officer matches against the paper in their hand
            — wrapped to three lines while the affiliation badge and the
            date fought over the rest. A list row can put the identity on
            top and demote affiliation and date to one meta line beneath
            it, which is the shape of the task: read a name, find it on
            the stack of papers, tap Attest.

            `queue` is the single source of data and `queueRowLabel` the
            single source of the display name, so the two renderings can
            disagree about layout but not about content. */}
        <ul className="space-y-2 sm:hidden">
          {queue.map((member) => (
            <QueueCard
              key={member.userId}
              member={member}
              canVerify={canVerify}
              selected={selected.has(member.userId)}
              onToggle={() => toggle(member.userId)}
              onAttest={() => onAttestOne(member.userId, queueRowLabel(member))}
              attesting={attest.isPending}
            />
          ))}
        </ul>

        {/* `overflow-y-hidden` alongside `overflow-x-auto`: a
            non-`visible` value on one axis computes the other axis'
            `visible` to `auto`, which leaves the wrapper capturing
            vertical scroll as well. */}
        <div className="hidden overflow-x-auto overflow-y-hidden sm:block">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {canVerify ? (
                  <th scope="col" className="w-10 px-2 py-2 text-left">
                    <Checkbox
                      aria-label="Select all"
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-2 py-2 text-left">
                  Name
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Affiliation
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Approved
                </th>
                {canVerify ? (
                  <th scope="col" className="px-2 py-2 text-right">
                    Action
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {queue.map((member) => {
                const label = queueRowLabel(member);
                return (
                  <tr key={member.userId} className="border-b last:border-0">
                    {canVerify ? (
                      <td className="px-2 py-3">
                        <Checkbox
                          aria-label={`Select ${label}`}
                          checked={selected.has(member.userId)}
                          onCheckedChange={() => toggle(member.userId)}
                        />
                      </td>
                    ) : null}
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
                      {member.approvedAt ? formatDate(member.approvedAt) : "—"}
                    </td>
                    {canVerify ? (
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
                    ) : null}
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

/**
 * The name an officer reads off the row.
 *
 * One function rather than the expression inlined in each rendering: the
 * mobile list and the desktop table are separate markup, and a display
 * name that differed between them would be a genuinely confusing bug to
 * chase — the same member, two labels, depending on the width of the
 * window.
 */
function queueRowLabel(member: MemberNeedingAttestation): string {
  return member.preferredName ?? member.fullName ?? member.email;
}

/**
 * One queued member as a stacked row, for viewports below `sm`.
 *
 * Identity on the first two lines (the name, then the email that gets
 * matched against the paper), affiliation and approval date demoted to a
 * single meta line, and the action on its own row so it gets a full
 * 44px-tall target instead of being wedged into a table cell. The
 * checkbox is the row's leading column at both sizes, so the selection
 * gesture doesn't move as the layout changes.
 *
 * The whole row is a label for its checkbox, which is the part a table
 * cell can't do: on a phone the reachable target for "select this
 * member" should be the member, not a 16px box beside them. The Attest
 * button is outside that label — nesting a button inside a label makes
 * a tap on it toggle the checkbox too.
 */
function QueueCard({
  member,
  canVerify,
  selected,
  onToggle,
  onAttest,
  attesting,
}: {
  member: MemberNeedingAttestation;
  canVerify: boolean;
  selected: boolean;
  onToggle: () => void;
  onAttest: () => void;
  attesting: boolean;
}) {
  const label = queueRowLabel(member);

  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start gap-3">
        {canVerify ? (
          <Checkbox
            id={`queue-${member.userId}`}
            aria-label={`Select ${label}`}
            checked={selected}
            onCheckedChange={onToggle}
            className="mt-0.5 shrink-0"
          />
        ) : null}
        {/* A `<label>` only when there is a control for it to label.
            Read-only viewers (`waivers:view` without `waivers:verify`)
            get no checkbox, and a label pointing at nothing is a
            promise of interactivity the row can't keep. */}
        <Identity
          as={canVerify ? "label" : "div"}
          htmlFor={canVerify ? `queue-${member.userId}` : undefined}
        >
          <div className="font-medium break-words">{label}</div>
          {/* `break-all`, not `truncate`: a truncated address is
              useless for the one thing it is here to do, which is match
              a member against a signed paper. A long uc.edu address
              wrapping over two lines is the lesser cost. */}
          <div className="text-xs break-all text-muted-foreground">
            {member.email}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {member.ucAffiliation ? (
              <Badge variant="outline" className="text-xs">
                {member.ucAffiliation}
              </Badge>
            ) : null}
            <span>
              Approved {member.approvedAt ? formatDate(member.approvedAt) : "—"}
            </span>
          </div>
        </Identity>
      </div>
      {canVerify ? (
        <Button
          size="sm"
          variant="outline"
          onClick={onAttest}
          disabled={attesting}
          className="mt-3 w-full"
        >
          Attest
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The identity block of a queue card, as a `<label>` for verifiers and a
 * plain `<div>` for read-only viewers.
 *
 * Split out only so the branch doesn't duplicate four nested elements;
 * the reason for the branch is on the call site.
 */
function Identity({
  as,
  htmlFor,
  children,
}: {
  as: "label" | "div";
  htmlFor: string | undefined;
  children: React.ReactNode;
}) {
  const className = "min-w-0 flex-1 space-y-0.5";

  return as === "label" ? (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ) : (
    <div className={className}>{children}</div>
  );
}
