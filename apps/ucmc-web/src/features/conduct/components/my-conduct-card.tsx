import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "#/components/ui/card";
import { myActiveSanctionsQueryOptions } from "#/features/conduct/api/queries";
import { formatPlainDate } from "#/features/conduct/lib/format";
import {
  APPEAL_LINE,
  CONDUCT_LEVEL_LABELS,
} from "#/features/conduct/server/limits";
import type { MyActiveSanction } from "#/features/conduct/server/record-fns";

function dates(sanction: MyActiveSanction): string {
  const { startsOn, endsOn } = sanction;
  const today = Temporal.Now.plainDateISO("America/New_York");
  const upcoming =
    startsOn !== null && Temporal.PlainDate.compare(startsOn, today) > 0;
  if (upcoming) {
    return endsOn
      ? `Starts ${formatPlainDate(startsOn)}, until ${formatPlainDate(endsOn)}`
      : `Starts ${formatPlainDate(startsOn)}`;
  }
  return endsOn ? `until ${formatPlainDate(endsOn)}` : "";
}

/**
 * The member's own active warnings, suspensions and terminations, with
 * the statement they were sent and the way to appeal. Renders nothing
 * when there are none.
 */
export function MyConductCard() {
  const { data } = useQuery(myActiveSanctionsQueryOptions());
  if (!data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-sm font-semibold">Conduct notices</h2>
        <ul className="space-y-4">
          {data.map((sanction, index) => (
            <li key={index} className="space-y-1">
              <p className="text-sm font-medium">
                {CONDUCT_LEVEL_LABELS[sanction.level]}
                {dates(sanction) ? (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {dates(sanction)}
                  </span>
                ) : null}
              </p>
              <p className="text-sm whitespace-pre-wrap">
                {sanction.statement}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{APPEAL_LINE}</p>
      </CardContent>
    </Card>
  );
}
