import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { memberConductSummaryQueryOptions } from "#/features/conduct/api/queries";
import { formatPlainDate } from "#/features/conduct/lib/format";
import { CONDUCT_LEVEL_LABELS } from "#/features/conduct/server/limits";

/**
 * A member's conduct record at a glance, on their profile. Renders
 * nothing when the server answers null (no `conduct:view`, or the viewer
 * is the subject), so the card's absence reveals nothing.
 */
export function MemberConductCard({ userId }: { userId: string }) {
  const { data } = useQuery(memberConductSummaryQueryOptions(userId));
  if (!data) {
    return null;
  }

  const counts = (
    Object.keys(CONDUCT_LEVEL_LABELS) as Array<
      keyof typeof CONDUCT_LEVEL_LABELS
    >
  )
    .filter((level) => data.counts[level] > 0)
    .map((level) => {
      const n = data.counts[level];
      const label = CONDUCT_LEVEL_LABELS[level].toLowerCase();
      return `${n} ${label}${n === 1 ? "" : "s"}`;
    })
    .join(" · ");

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Conduct</h2>
          <Link
            to="/conduct/records"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            All records
          </Link>
        </div>
        <p className="text-sm">{counts || "No records"}</p>
        {data.standing.terminated ? (
          <Badge variant="destructive">Terminated</Badge>
        ) : data.standing.suspendedUntil ? (
          <Badge variant="warning">
            Suspended until {formatPlainDate(data.standing.suspendedUntil)}
          </Badge>
        ) : null}
        {data.records.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {data.records.map((record) => (
              <li key={record.publicId}>
                <Link
                  to="/conduct/$publicId"
                  params={{ publicId: record.publicId }}
                  className="underline-offset-2 hover:underline"
                >
                  {CONDUCT_LEVEL_LABELS[record.level]}
                  {record.startsOn
                    ? `, ${formatPlainDate(record.startsOn)}`
                    : ""}
                </Link>
                {record.liftedAt ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Lifted
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
