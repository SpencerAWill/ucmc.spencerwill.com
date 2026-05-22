import { CalendarOff, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type {
  OfficerEntry,
  OfficerYearGroup,
} from "#/features/history/server/history-fns";

const ALL_YEARS_VALUE = "__all__";

/**
 * Past-officer archive with a year selector and inline manage
 * affordances.
 *
 * Default view is the most recent year only; the selector lets a
 * reader jump to any other year or expand to "All years" for the
 * full scroll. Selection is local state — deep links to a specific
 * year don't currently survive a refresh, which is an acceptable
 * trade-off for keeping this a content surface, not an app surface.
 *
 * When `canManage` is true (i.e. the viewer holds `history:manage`),
 * the component decorates each rendered card with:
 *   - a "Delete year" button on the card header (bulk-removes every
 *     officer row for that schoolYear),
 *   - a pencil button on each row (opens the parent's edit dialog),
 *   - a trash button on each row (opens the parent's per-row delete
 *     confirm).
 * The dialogs themselves live at the route level; this component
 * just emits callbacks.
 */
export function PastOfficers({
  groups,
  canManage = false,
  onEditOfficer,
  onDeleteOfficer,
  onDeleteYear,
}: {
  groups: OfficerYearGroup[];
  canManage?: boolean;
  onEditOfficer?: (group: OfficerYearGroup, officer: OfficerEntry) => void;
  onDeleteOfficer?: (officer: OfficerEntry) => void;
  onDeleteYear?: (group: OfficerYearGroup) => void;
}) {
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
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold tracking-tight">
                {group.schoolYear}
              </h3>
              {canManage && onDeleteYear ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete entire ${group.schoolYear} year`}
                  onClick={() => onDeleteYear(group)}
                >
                  <CalendarOff className="size-4" />
                  Delete year
                </Button>
              ) : null}
            </div>
            <dl className="space-y-1 text-sm">
              {group.officers.map((officer) => (
                <div
                  key={officer.id}
                  className="grid grid-cols-[max-content_1fr_max-content] items-baseline gap-x-4"
                >
                  <dt className="font-medium text-muted-foreground">
                    {officer.role}
                  </dt>
                  <dd>
                    <p>{officer.name}</p>
                    {officer.notes ? (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">
                        {officer.notes}
                      </p>
                    ) : null}
                  </dd>
                  <dd className="flex justify-end gap-1">
                    {canManage && onEditOfficer ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Edit ${officer.role} (${group.schoolYear})`}
                        onClick={() => onEditOfficer(group, officer)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    ) : null}
                    {canManage && onDeleteOfficer ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Delete ${officer.role} (${group.schoolYear})`}
                        onClick={() => onDeleteOfficer(officer)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
