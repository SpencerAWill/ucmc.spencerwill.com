import { Images, Pencil, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { formatDate } from "#/lib/date-format";
import {
  groupByClubYear,
  totalService,
} from "#/features/volunteer/lib/service-totals";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

/**
 * The archive of outings the club has already done, newest first,
 * grouped by club year, under a totals strip.
 *
 * This is the band an outside organization reads before deciding
 * whether to ask — "have these people actually turned up before" — so
 * it leads with the totals rather than burying them under the list.
 */
export function ServiceRecord({
  outings,
  canManage = false,
  onEdit,
  onDelete,
}: {
  outings: VolunteerEventEntry[];
  canManage?: boolean;
  onEdit?: (outing: VolunteerEventEntry) => void;
  onDelete?: (outing: VolunteerEventEntry) => void;
}) {
  if (outings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No past outings on record yet.
      </p>
    );
  }

  const totals = totalService(outings);
  const groups = groupByClubYear(outings);

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border/60 bg-card/40 p-4 sm:grid-cols-3">
        <Stat
          label={totals.outings === 1 ? "Outing" : "Outings"}
          value={totals.outings}
        />
        <Stat
          label="Volunteers"
          value={totals.volunteers}
          // The denominator matters: a sum over 3 of 40 outings is not
          // the club's record, it's the part of it somebody wrote down.
          footnote={coverageNote(totals.volunteersReportedFor, totals.outings)}
        />
        <Stat
          label="Service hours"
          value={totals.hours}
          footnote={coverageNote(totals.hoursReportedFor, totals.outings)}
        />
      </dl>

      {groups.map((group) => (
        <section key={group.clubYear} className="space-y-2">
          <h3 className="text-sm font-semibold tracking-tight text-muted-foreground">
            {group.clubYear}
          </h3>
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            {group.outings.map((outing) => (
              <li
                key={outing.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{outing.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(
                      Temporal.Instant.fromEpochMilliseconds(outing.startsAtMs),
                    )}
                    {outing.partnerOrg ? ` · ${outing.partnerOrg}` : ""}
                    {outing.location ? ` · ${outing.location}` : ""}
                  </p>
                </div>
                <ContributionSummary outing={outing} />
                {outing.albumTag ? (
                  <Button asChild variant="ghost" size="sm" className="h-7">
                    <Link to="/album" search={{ tag: outing.albumTag }}>
                      <Images className="size-3.5" />
                      Photos
                    </Link>
                  </Button>
                ) : null}
                {canManage ? (
                  <div className="flex shrink-0 gap-1">
                    {onEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Edit ${outing.title}`}
                        onClick={() => onEdit(outing)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    ) : null}
                    {onDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Delete ${outing.title}`}
                        onClick={() => onDelete(outing)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  footnote,
}: {
  label: string;
  value: number;
  footnote?: string | null;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {footnote ? (
        <p className="text-xs text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}

/**
 * Only shown when the figure was recorded for some but not all outings.
 * Full coverage needs no caveat, and zero coverage is already obvious
 * from a total of 0.
 */
function coverageNote(reportedFor: number, total: number): string | null {
  if (reportedFor === 0 || reportedFor === total) {
    return null;
  }
  return `recorded for ${reportedFor} of ${total}`;
}

function ContributionSummary({ outing }: { outing: VolunteerEventEntry }) {
  const parts: string[] = [];
  if (outing.volunteersCount !== null) {
    parts.push(
      `${outing.volunteersCount} ${
        outing.volunteersCount === 1 ? "volunteer" : "volunteers"
      }`,
    );
  }
  if (outing.serviceHours !== null) {
    parts.push(`${outing.serviceHours} hrs`);
  }
  if (parts.length === 0) {
    return null;
  }
  return (
    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {parts.join(" · ")}
    </p>
  );
}
