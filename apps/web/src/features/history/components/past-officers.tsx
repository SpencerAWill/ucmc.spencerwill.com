import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { OfficerYearGroup } from "#/features/history/server/history-fns";

const ALL_YEARS_VALUE = "__all__";

/**
 * Past-officer archive with a year selector.
 *
 * The full archive runs ~50 years × 5–6 roles, which is a lot to render
 * unconditionally — so the default view is the most recent year only,
 * and the selector lets a reader jump to any other year or expand to
 * "All years" for the full scroll.
 *
 * Selection is local state (no URL param) because the archive is a
 * content surface, not an app surface — deep links to a specific year
 * don't currently survive a refresh, and that's an acceptable tradeoff
 * for keeping this a one-component change.
 */
export function PastOfficers({ groups }: { groups: OfficerYearGroup[] }) {
  // Groups arrive newest-first from the server (start_year DESC). The
  // default selection is the first group; if the archive is somehow
  // empty (fresh DB) we fall through to the empty-state block below.
  const initialSelection = groups[0]?.schoolYear ?? ALL_YEARS_VALUE;
  const [selected, setSelected] = useState<string>(initialSelection);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Past-officer records are being assembled. Check back soon.
      </p>
    );
  }

  const visible =
    selected === ALL_YEARS_VALUE
      ? groups
      : groups.filter((g) => g.schoolYear === selected);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label
          htmlFor="past-officers-year"
          className="text-sm font-medium text-muted-foreground"
        >
          Show
        </label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="past-officers-year" className="w-[14rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_YEARS_VALUE}>
              All years ({groups.length} total)
            </SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.schoolYear} value={group.schoolYear}>
                {group.schoolYear}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-6">
        {visible.map((group) => (
          <article
            key={group.schoolYear}
            className="space-y-2 rounded-md border border-border/60 bg-card/50 p-4"
          >
            <h3 className="text-sm font-semibold tracking-tight">
              {group.schoolYear}
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              {group.officers.map((officer) => (
                <div key={officer.id} className="contents">
                  <dt className="font-medium text-muted-foreground">
                    {officer.role}
                  </dt>
                  <dd>{officer.name}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
